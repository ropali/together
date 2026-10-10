import { Peer, type DataConnection, type PeerOptions } from 'peerjs'
import * as Y from 'yjs'

export type MeshTopology = 'star' | 'mesh'

export type P2PYjsOptions = {
  topology?: MeshTopology
  peerId?: string
  displayName?: string
  onPeerConnected?: (peerId: string) => void
  onPeerDisconnected?: (peerId: string) => void
  onPeerPresence?: (peerId: string, displayName: string) => void
  onPeerSynced?: (peerId: string) => void
  onOwnerChanged?: (peerId: string, displayName: string) => void
  onError?: (error: Error) => void
}

type WireMessage =
  | { type: 'update' | 'snapshot'; update: string }
  | { type: 'presence'; displayName: string }
  | { type: 'hello' }
  | { type: 'roster'; peerIds: string[]; topology: MeshTopology }
  | { type: 'owner'; peerId: string; displayName: string }
  | { type: 'synced' }

const CONNECTION_TIMEOUT_MS = 20_000
const SIGNALING_TIMEOUT_MS = 15_000
const BINARY_CHUNK_SIZE = 0x8000

function turnIsConfigured(): boolean {
  const urls = import.meta.env['VITE_TURN_URLS']
    ?.split(',')
    .map((url: string) => url.trim())
    .filter((url: string) => url.length > 0)
  return Boolean(urls?.length && import.meta.env['VITE_TURN_USERNAME'] && import.meta.env['VITE_TURN_CREDENTIAL'])
}

function peerOptions(): PeerOptions {
  const turnUrlsValue = import.meta.env['VITE_TURN_URLS']
  const turnUsername = import.meta.env['VITE_TURN_USERNAME']
  const turnCredential = import.meta.env['VITE_TURN_CREDENTIAL']
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
  ]
  const turnUrls = turnUrlsValue
    ?.split(',')
    .map((url: string) => url.trim())
    .filter((url: string) => url.length > 0)
  if (turnUrls?.length) {
    const turnServer: RTCIceServer = { urls: turnUrls }
    if (turnUsername) turnServer.username = turnUsername
    if (turnCredential) turnServer.credential = turnCredential
    iceServers.push(turnServer)
  }
  return {
    config: {
      iceServers,
    },
  }
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + BINARY_CHUNK_SIZE, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function decodeBytes(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('Received an invalid Yjs update encoding.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function isWireMessage(value: unknown): value is WireMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  if ((value.type === 'update' || value.type === 'snapshot') && 'update' in value) {
    return typeof value.update === 'string'
  }
  if (value.type === 'presence' && 'displayName' in value) return typeof value.displayName === 'string'
  if (value.type === 'owner' && 'peerId' in value && typeof value.peerId === 'string' &&
    'displayName' in value && typeof value.displayName === 'string') return true
  if (value.type === 'hello' || value.type === 'synced') return true
  return value.type === 'roster' && 'peerIds' in value && Array.isArray(value.peerIds) &&
    value.peerIds.every((id: unknown) => typeof id === 'string') &&
    'topology' in value && (value.topology === 'star' || value.topology === 'mesh')
}

function waitForPeerId(peer: Peer): Promise<string> {
  if (peer.id) return Promise.resolve(peer.id)
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out while registering with the PeerJS signaling service.'))
    }, SIGNALING_TIMEOUT_MS)
    const onOpen = (id: string) => {
      cleanup()
      resolve(id)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      peer.off('open', onOpen)
      peer.off('error', onError)
    }
    peer.on('open', onOpen)
    peer.on('error', onError)
  })
}

function waitForConnection(connection: DataConnection): Promise<void> {
  if (connection.open) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out while connecting to peer "${connection.peer}".`))
    }, CONNECTION_TIMEOUT_MS)
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onClose = () => {
      cleanup()
      reject(new Error(`Peer "${connection.peer}" closed the connection before it was ready.`))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(new Error(error.message || `Could not connect to peer "${connection.peer}".`))
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      connection.off('open', onOpen)
      connection.off('close', onClose)
      connection.off('error', onError)
    }
    connection.on('open', onOpen)
    connection.on('close', onClose)
    connection.on('error', onError)
  })
}

export class P2PYjsRoom {
  readonly doc = new Y.Doc()
  readonly state = this.doc.getMap<unknown>('state')
  readonly peer: Peer
  hostPeerId: string

  private readonly options: P2PYjsOptions
  private readonly connections = new Map<string, DataConnection>()
  private readonly syncedPeers = new Set<string>()
  private readonly connectedPeers = new Set<string>()
  private readonly rosterPeers = new Set<string>()
  private readonly syncWaiters = new Map<string, Set<() => void>>()
  private readonly failedPeers = new Set<string>()
  private topology: MeshTopology
  private peerId = ''
  private closed = false

  private constructor(
    peer: Peer,
    hostPeerId: string,
    options: P2PYjsOptions,
  ) {
    this.peer = peer
    this.hostPeerId = hostPeerId
    this.options = options
    this.topology = options.topology ?? 'mesh'

    this.peer.on('connection', (connection) => this.acceptConnection(connection))
    this.peer.on('error', (error) => {
      this.reportError(new Error(`PeerJS ${error.type}: ${error.message}`))
    })
    this.peer.on('disconnected', () => {
      this.reportError(new Error('The PeerJS signaling connection was lost. Existing WebRTC data channels may remain active.'))
    })

    this.doc.on('update', this.onDocumentUpdate)
  }

  static async host(options: P2PYjsOptions = {}): Promise<P2PYjsRoom> {
    const peer = options.peerId ? new Peer(options.peerId, peerOptions()) : new Peer(peerOptions())
    const room = new P2PYjsRoom(peer, '', options)
    try {
      room.peerId = await waitForPeerId(peer)
      return room
    } catch (error) {
      room.destroy()
      throw error
    }
  }

  static async join(hostPeerId: string, options: P2PYjsOptions = {}): Promise<P2PYjsRoom> {
    const normalizedHostId = hostPeerId.trim()
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/.test(normalizedHostId)) {
      throw new Error('Enter a valid PeerJS host ID.')
    }

    const peer = new Peer(peerOptions())
    const room = new P2PYjsRoom(peer, normalizedHostId, options)
    try {
      room.peerId = await waitForPeerId(peer)
      const connection = room.openConnection(normalizedHostId)
      await waitForConnection(connection)
      await room.waitForPeerSync(normalizedHostId)
      return room
    } catch (error) {
      room.destroy()
      throw error
    }
  }

  get id(): string {
    return this.peerId
  }

  get peers(): string[] {
    return [...this.connectedPeers]
  }

  get syncedPeerIds(): string[] {
    return [...this.syncedPeers]
  }

  electSuccessor(): string | null {
    if (!this.hostPeerId) return null
    const candidates = new Set([...this.rosterPeers, ...this.connectedPeers, this.peerId])
    candidates.delete(this.hostPeerId)
    return [...candidates].sort((left, right) => left.localeCompare(right))[0] ?? null
  }

  promoteToOwner(displayName: string): void {
    if (this.closed || !this.hostPeerId || this.connections.has(this.hostPeerId) ||
      this.electSuccessor() !== this.peerId) return
    this.hostPeerId = ''
    this.topology = 'mesh'
    this.options.onOwnerChanged?.(this.peerId, displayName)
    this.broadcast({ type: 'owner', peerId: this.peerId, displayName })
    this.broadcastRoster()
  }

  transferOwnership(peerId: string, displayName: string): void {
    if (this.closed || this.hostPeerId || !this.connectedPeers.has(peerId)) {
      throw new Error('Ownership can only be transferred to a connected peer.')
    }
    this.applyOwnerChange(peerId, displayName)
    this.broadcast({ type: 'owner', peerId, displayName })
    this.broadcastRoster()
  }

  waitForPeerSync(peerId: string): Promise<void> {
    if (this.syncedPeers.has(peerId)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const waiters = this.syncWaiters.get(peerId) ?? new Set<() => void>()
      const finish = () => {
        window.clearTimeout(timeout)
        waiters.delete(finish)
        if (waiters.size === 0) this.syncWaiters.delete(peerId)
        resolve()
      }
      const timeout = window.setTimeout(() => {
        waiters.delete(finish)
        if (waiters.size === 0) this.syncWaiters.delete(peerId)
        reject(new Error(`Timed out waiting for the board snapshot from peer "${peerId}".`))
      }, CONNECTION_TIMEOUT_MS)
      waiters.add(finish)
      this.syncWaiters.set(peerId, waiters)
    })
  }

  destroy(): void {
    if (this.closed) return
    this.closed = true
    this.doc.off('update', this.onDocumentUpdate)
    for (const connection of this.connections.values()) connection.close()
    this.connections.clear()
    this.syncedPeers.clear()
    this.connectedPeers.clear()
    this.rosterPeers.clear()
    this.syncWaiters.clear()
    this.peer.destroy()
    this.doc.destroy()
  }

  private readonly onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    this.broadcast({ type: 'update', update: encodeBytes(update) }, origin)
  }

  private acceptConnection(connection: DataConnection): void {
    if (this.topology === 'mesh' && this.hostPeerId && this.peerId && connection.peer !== this.hostPeerId &&
      connection.peer !== this.peerId && this.peerId.localeCompare(connection.peer) < 0) {
      connection.close()
      return
    }
    this.attachConnection(connection)
  }

  private openConnection(peerId: string): DataConnection {
    const existing = this.connections.get(peerId)
    if (existing) return existing

    const connection = this.peer.connect(peerId, {
      label: 'yjs-room',
      reliable: true,
      serialization: 'json',
      metadata: { displayName: this.options.displayName?.trim() || 'Participant' },
    })
    this.attachConnection(connection)
    return connection
  }

  private attachConnection(connection: DataConnection): void {
    const existing = this.connections.get(connection.peer)
    if (existing && existing !== connection) {
      connection.close()
      return
    }
    this.connections.set(connection.peer, connection)

    connection.on('open', () => this.onConnectionOpen(connection))
    connection.on('data', (data) => this.onConnectionData(connection, data))
    connection.on('close', () => this.onConnectionClose(connection))
    connection.on('error', (error) => {
      if (error.type === 'negotiation-failed') {
        this.reportIceFailure(connection.peer)
        return
      }
      this.reportError(new Error(`Peer "${connection.peer}": ${error.message}`))
    })
    connection.on('iceStateChanged', (state) => {
      if (state === 'failed') {
        this.reportIceFailure(connection.peer)
      }
    })
    if (connection.open) this.onConnectionOpen(connection)
  }

  private onConnectionOpen(connection: DataConnection): void {
    if (this.closed || this.connections.get(connection.peer) !== connection) return
    const isNew = !this.connectedPeers.has(connection.peer)
    this.connectedPeers.add(connection.peer)
    if (isNew) this.options.onPeerConnected?.(connection.peer)
    const metadata = connection.metadata as { displayName?: unknown } | undefined
    if (typeof metadata?.displayName === 'string') {
      this.options.onPeerPresence?.(connection.peer, metadata.displayName)
    }

    this.send(connection, { type: 'snapshot', update: encodeBytes(Y.encodeStateAsUpdate(this.doc)) })
    this.send(connection, {
      type: 'presence',
      displayName: this.options.displayName?.trim() || (this.hostPeerId ? 'Participant' : 'Owner'),
    })

    if (!this.hostPeerId) {
      this.send(connection, {
        type: 'owner',
        peerId: this.peerId,
        displayName: this.options.displayName?.trim() || 'Owner',
      })
    }

    if (connection.peer === this.hostPeerId) {
      this.send(connection, { type: 'hello' })
    } else if (!this.hostPeerId) {
      this.broadcastRoster()
    }
    this.connectToKnownPeers()
  }

  private onConnectionClose(connection: DataConnection): void {
    if (this.connections.get(connection.peer) !== connection) return
    this.connections.delete(connection.peer)
    this.syncedPeers.delete(connection.peer)
    const wasConnected = this.connectedPeers.delete(connection.peer)
    this.rosterPeers.delete(connection.peer)
    if (wasConnected) this.options.onPeerDisconnected?.(connection.peer)
    if (!this.hostPeerId) this.broadcastRoster()
  }

  private onConnectionData(connection: DataConnection, data: unknown): void {
    if (!isWireMessage(data)) {
      this.reportError(new Error(`Received an unsupported message from peer "${connection.peer}".`))
      return
    }

    try {
      switch (data.type) {
        case 'update':
        case 'snapshot':
          Y.applyUpdate(this.doc, decodeBytes(data.update), connection)
          if (data.type === 'snapshot') {
            this.markPeerSynced(connection.peer)
            this.send(connection, { type: 'synced' })
          }
          break
        case 'hello':
          if (!this.hostPeerId) this.broadcastRoster()
          break
        case 'presence':
          this.options.onPeerPresence?.(connection.peer, data.displayName)
          break
        case 'roster':
          if (this.hostPeerId && connection.peer === this.hostPeerId) {
            this.topology = data.topology
            this.reconcileRoster(data.peerIds)
            this.connectToKnownPeers()
          }
          break
        case 'owner':
          if (connection.peer === this.hostPeerId) {
            this.applyOwnerChange(data.peerId, data.displayName)
            this.broadcastRoster()
          } else if (this.hostPeerId && !this.connections.has(this.hostPeerId) &&
            connection.peer === data.peerId && this.electSuccessor() === data.peerId) {
            this.applyOwnerChange(data.peerId, data.displayName)
            this.broadcastRoster()
          }
          break
        case 'synced':
          this.markPeerSynced(connection.peer)
          break
      }
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error('Could not apply a Yjs update.'))
    }
  }

  private broadcastRoster(): void {
    if (!this.peerId || this.hostPeerId) return
    const peerIds = [this.peerId, ...this.connectedPeers]
    this.broadcast({ type: 'roster', peerIds, topology: this.topology })
  }

  private applyOwnerChange(peerId: string, displayName: string): void {
    const previousOwnerId = this.hostPeerId || this.peerId
    this.hostPeerId = peerId === this.peerId ? '' : peerId
    this.topology = 'mesh'
    if (previousOwnerId !== peerId) this.options.onOwnerChanged?.(peerId, displayName)
  }

  private reconcileRoster(peerIds: string[]): void {
    const knownPeers = new Set(peerIds.filter((id) => id !== this.peerId && id !== this.hostPeerId))
    this.rosterPeers.clear()
    for (const id of knownPeers) this.rosterPeers.add(id)
    for (const [peerId, connection] of this.connections) {
      if (peerId !== this.hostPeerId && !knownPeers.has(peerId)) connection.close()
    }
  }

  private connectToKnownPeers(): void {
    if (this.topology !== 'mesh' || this.closed) return
    for (const peerId of this.knownPeerIds()) {
      if (peerId === this.hostPeerId || peerId === this.peerId || this.connections.has(peerId)) continue
      if (this.peerId.localeCompare(peerId) < 0) this.openConnection(peerId)
    }
  }

  private knownPeerIds(): string[] {
    return this.hostPeerId ? [...this.rosterPeers] : [...this.connectedPeers]
  }

  private markPeerSynced(peerId: string): void {
    if (!this.syncedPeers.has(peerId)) {
      this.syncedPeers.add(peerId)
      this.options.onPeerSynced?.(peerId)
    }
    for (const resolve of this.syncWaiters.get(peerId) ?? []) resolve()
  }

  private reportIceFailure(peerId: string): void {
    if (this.failedPeers.has(peerId)) return
    this.failedPeers.add(peerId)
    this.reportError(new Error(`${this.iceFailureMessage()} Failed peer: ${peerId}.`))
  }

  private iceFailureMessage(): string {
    return turnIsConfigured()
      ? 'ICE negotiation failed even though TURN is configured. Verify the TURN URL, username, credential, allowed ports, and certificate support.'
      : 'ICE negotiation failed and this build has no TURN relay configured. Direct-only WebRTC cannot connect through every NAT or firewall. Configure VITE_TURN_URLS, VITE_TURN_USERNAME, and VITE_TURN_CREDENTIAL with working TURN service credentials, then restart or rebuild the app.'
  }

  private broadcast(message: WireMessage, origin?: unknown): void {
    for (const [peerId, connection] of this.connections) {
      if (connection !== origin && connection.open) this.send(connection, message)
      if (!connection.open) this.connections.delete(peerId)
    }
  }

  private send(connection: DataConnection, message: WireMessage): void {
    if (!connection.open) return
    try {
      connection.send(message)
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(`Could not send data to peer "${connection.peer}".`))
    }
  }

  private reportError(error: Error): void {
    this.options.onError?.(error)
  }
}
