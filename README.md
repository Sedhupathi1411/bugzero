# BugZero

BugZero is a software platform and VS Code extension designed for conducting debugging events and competitions. It provides a seamless environment for participants to view problems, pull them directly into their editor, and submit their solutions for verification.

## Project Structure

The project is divided into two main components:

- **`bugzero-server`**: A Node.js/Express backend that manages problems, users, and submissions using Prisma and PostgreSQL.
- **`bugzero-extension`**: A VS Code extension that serves as the interface for participants.

> **Note on Competition Environment**: This platform was developed with the assumption that participants are physically present at the same venue and are being actively proctored/watched during the event.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)
- [VS Code](https://code.visualstudio.com/)
- [PostgreSQL](https://www.postgresql.org/)

---

### 1. Server Setup (`bugzero-server`)

The server manages the core logic and database for the competition.

1. **Navigate to the server directory:**

   ```bash
   cd bugzero-server
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env` and fill in the required values:

   ```bash
   cp .env.example .env
   ```

   Ensure you set:
   - `DATABASE_URL`: Your PostgreSQL connection string.
   - `SHARED_PASSWORD`: The password for user registration.
   - `ADMIN_USERNAME`: Username for admin access.
   - `ADMIN_PASSWORD`: Password for admin access.

4. **Initialize the Database:**

   ```bash
   npx prisma db push
   ```

5. **Start the Server:**

   ```bash
   npm run dev
   ```

   The server will run on `http://localhost:3000` by default.

---

### 2. Extension Setup (`bugzero-extension`)

The extension provides the UI for participants.

1. **Navigate to the extension directory:**

   ```bash
   cd bugzero-extension
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3.  **Configure Backend URL:**

    - Open `bugzero-extension/src/SidebarProvider.tsx`.

    - Update the `_baseUrl` in the `constructor` to point to your deployed server URL:

    ```typescript

    this._baseUrl =

      _context.extensionMode === vscode.ExtensionMode.Production

        ? "https://your-deployed-server.com" // Replace with your URL

        : "http://localhost:3000";

    ```



4.  **Build the Extension:**



   ```bash
   npm run compile
   ```

   For development with hot-reloading:

   ```bash
   npm run watch
   ```

4. **Run the Extension:**
   - Open the `bugzero-extension` folder in VS Code.
   - Press `F5` to open a new "Extension Development Host" window with BugZero loaded.
   - You should see the BugZero icon in the Activity Bar.

---

## Deployment

### Server Deployment

- The server can be deployed to platforms like Heroku, Render, or any VPS.
- Ensure the environment variables are correctly set in your production environment.
- Use `npm run build` followed by `npm run start` for production.

### Extension Distribution

- To package the extension for distribution, use `vsce`:

  ```bash
  npx vsce package
  ```

- This will generate a `.vsix` file that can be shared and installed in VS Code.

## Known Issues

- **Output Matching Bug:** In some cases, a submission might be reported as failing even when the "Expected" and "Actual" outputs appear identical. This may be due to subtle presentation or formatting differences (e.g., trailing spaces, newline variations).

## License

This project is licensed under a **Custom Non-Commercial License**.

- **You are free to**: Use the software to conduct events or competitions, and modify the code as needed.
- **Restriction**: You **MAY NOT SELL** the original or modified code for commercial gain.

See the [LICENSE](LICENSE) file for the full text.
