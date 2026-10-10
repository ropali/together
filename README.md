# Together

Together is an open-source, browser-based retrospective board built with React and TypeScript. Teams can create boards, add and react to notes, and synchronize updates directly between browsers using WebRTC and Yjs.

## Features

- Create boards with a custom title and two to five columns.
- Share invite links and join with a display name.
- Add notes, react with emoji, and lock a board.
- Use a shared meeting timer and transfer board ownership.
- Automatically elect a new owner from connected peers if the current owner disconnects.
- Customize the board appearance, hide notes, and print or save a board as PDF.
- Save boards locally in the browser.

## Run locally

Requirements: Node.js 20.19+ or 22.12+, and npm.

```sh
npm install
npm run dev
```

Available commands:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Type-check and create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run Oxlint |

To deploy, run `npm run build` and serve the generated `dist/` directory from a static web host. Configure that host to serve the app entry point for board URLs.

## Deploy to GitHub Pages

The `Deploy to GitHub Pages` workflow builds and publishes the site when changes are pushed to `main`; it can also be started manually from the repository's **Actions** tab. In the repository settings, open **Pages** and set the build and deployment source to **GitHub Actions**. After the first successful workflow run, the app is available at <https://ropali.github.io/together/>.

The Pages build uses the `/together/` repository path, while local development and previews use `/`. TURN environment variables, if needed, must be configured as GitHub Actions variables/secrets and passed to the build step because Vite embeds them at build time.

## Peer-to-peer networking

Board state is synchronized with Yjs over direct WebRTC data channels. PeerJS's public PeerServer is used for peer-ID registration and initial connection signaling; it does not carry board state. A public Google STUN server is configured to help establish direct connections.

The app uses a peer mesh so connected participants can continue synchronizing if the owner leaves. An owner may transfer ownership to a connected peer, and peers deterministically elect a successor if the owner disconnects. During a network partition, separate groups can temporarily elect different owners; without a coordinating server, global ownership consensus is not possible.

Direct WebRTC connections are not available on every network. When peers are behind restrictive NATs or firewalls, a TURN relay may be needed. Add a `.env.local` file with TURN service credentials:

```dotenv
VITE_TURN_URLS=turn:turn.example.com:3478
VITE_TURN_USERNAME=your-short-lived-username
VITE_TURN_CREDENTIAL=your-short-lived-credential
```

`VITE_TURN_URLS` accepts comma-separated `turn:` or `turns:` URLs. Restart the development server or rebuild and redeploy after changing these build-time variables. Do not commit real credentials. TURN relays encrypted WebRTC traffic when selected, so it is a relay rather than a direct peer route.

## Data and security notes

Boards are saved in the current browser's local storage. Shared state is sent between connected peers; there is no application backend or hosted board database. PeerJS provides rendezvous/signaling for connection setup.

Owner-only actions are enforced in the client UI, not by a trusted server. A modified client can bypass those controls. In a serverless peer mesh, participants must trust one another.

## License

This project is licensed under the [MIT License](LICENSE).

Third-party dependencies are distributed under their own licenses. See the relevant package metadata and license files for details.
