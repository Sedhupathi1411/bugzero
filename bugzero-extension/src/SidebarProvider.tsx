import * as vscode from "vscode";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execPromise = promisify(exec);
export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  private readonly _baseUrl: string;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {
    this._baseUrl =
      _context.extensionMode === vscode.ExtensionMode.Production
        ? "https://bugzero.onrender.com"
        : "http://localhost:3000";
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Track active editor
    this._context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          const fileName = path.basename(editor.document.fileName);
          this._view?.webview.postMessage({
            command: "activeFile",
            fileName,
          });
        }
      }),
    );

    webviewView.webview.onDidReceiveMessage(async (data) => {
      console.log("Message received in backend:", data.command);
      switch (data.command) {
        case "checkLogin": {
          const savedAuth = this._context.globalState.get<{
            auth: string;
            username: string;
          }>("loginData");
          if (savedAuth) {
            try {
              const response = await fetch(`${this._baseUrl}/register`, {
                method: "POST",
                headers: {
                  Authorization: `Basic ${savedAuth.auth}`,
                },
              });

              if (response.ok) {
                const result: any = await response.json();
                this._view?.webview.postMessage({
                  command: "loginResponse",
                  success: true,
                  auth: savedAuth.auth,
                  username: savedAuth.username,
                  user: result.user,
                  problems: result.problems,
                });
              } else {
                // If token expired or invalid, clear it
                await this._context.globalState.update("loginData", undefined);
                this._view?.webview.postMessage({
                  command: "loginResponse",
                  success: false,
                });
              }
            } catch (err) {
              // Network error, still show logged in but maybe with a warning
              this._view?.webview.postMessage({
                command: "loginResponse",
                success: true,
                auth: savedAuth.auth,
                username: savedAuth.username,
              });
            }
          }
          // Also send active file on checkLogin
          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor) {
            this._view?.webview.postMessage({
              command: "activeFile",
              fileName: path.basename(activeEditor.document.fileName),
            });
          }
          break;
        }
        case "getFiles": {
          await this.pullProblems(false);
          break;
        }
        case "login": {
          const { username, password } = data.value;
          const auth = Buffer.from(`${username}:${password}`).toString(
            "base64",
          );
          try {
            const response = await fetch(`${this._baseUrl}/register`, {
              method: "POST",
              headers: {
                Authorization: `Basic ${auth}`,
              },
            });

            if (response.ok) {
              const result: any = await response.json();
              const problems = result.problems || [];

              // Persist login
              await this._context.globalState.update("loginData", {
                auth,
                username,
              });

              // Sync problems (write missing ones)
              await this.syncProblems(problems);

              this._view?.webview.postMessage({
                command: "loginResponse",
                success: true,
                auth,
                username,
                user: result.user,
                problems: problems, // Send problems to webview for testcases
              });

              // Also refresh file list
              await this.pullProblems(false);
            } else {
              const errorData = await response.json().catch(() => ({}));
              this._view?.webview.postMessage({
                command: "loginResponse",
                success: false,
                error: errorData.error || "Invalid credentials",
              });
            }
          } catch (err) {
            console.error("Login fetch error:", err);
            this._view?.webview.postMessage({
              command: "loginResponse",
              success: false,
              error: "Server connection failed",
            });
          }
          break;
        }
        case "pull": {
          await this.pullProblems(true);
          break;
        }
        case "logout": {
          const result = await vscode.window.showInformationMessage(
            "Are you sure you want to log out?",
            "Yes",
            "No",
          );

          if (result === "Yes") {
            await this._context.globalState.update("loginData", undefined);
            this._view?.webview.postMessage({ command: "logoutSuccess" });
            // Refresh files after logout to show local state
            await this.pullProblems(false);
          }
          break;
        }
        case "openFile": {
          const { fileName } = data.value;
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders) {
            return;
          }

          const fileUri = vscode.Uri.joinPath(
            workspaceFolders[0].uri,
            fileName,
          );
          try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document);
          } catch (err) {
            vscode.window.showErrorMessage(`Error opening file: ${err}`);
          }
          break;
        }
        case "run": {
          const { fileName, input, expectedOutput, problemId, testCaseIndex } = data.value;
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders) return;

          const rootPath = workspaceFolders[0].uri.fsPath;
          const filePath = path.join(rootPath, fileName);
          const isPython = fileName.endsWith(".py");
          const isC = fileName.endsWith(".c");

          let command = "";
          let args: string[] = [];

          if (isPython) {
            command = "python3";
            args = [filePath];
          } else if (isC) {
            const outputExe = path.join(
              rootPath,
              `temp_out_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            );
            try {
              const { stderr: compileStderr } = await execPromise(
                `gcc "${filePath}" -o "${outputExe}"`,
              );
              if (compileStderr) {
                console.warn("Compile warning:", compileStderr);
              }
              command = outputExe;
              args = [];
            } catch (err: any) {
              this._view?.webview.postMessage({
                command: "runResult",
                success: false,
                actualOutput: "",
                expectedOutput,
                problemId,
                testCaseIndex,
                stderr: `Compilation Error:\n${err.stderr || err.message}`,
              });
              return;
            }
          }

          if (!command) return;

          const child = spawn(command, args, { cwd: rootPath });

          let stdout = "";
          let stderr = "";
          let killed = false;

          const timeout = setTimeout(() => {
            child.kill();
            killed = true;
            this._view?.webview.postMessage({
              command: "runResult",
              success: false,
              actualOutput: "",
              expectedOutput,
              problemId,
              testCaseIndex,
              stderr: "Time Limit Exceeded (5s)",
            });
          }, 5000);

          child.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
          });

          child.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          child.on("close", (code: number) => {
            clearTimeout(timeout);
            if (killed) return;

            const actualOutput = stdout.trim();
            const success = actualOutput === expectedOutput.trim();

            this._view?.webview.postMessage({
              command: "runResult",
              success,
              actualOutput,
              expectedOutput,
              problemId,
              testCaseIndex,
              stderr:
                stderr ||
                (code !== 0 ? `Process exited with code ${code}` : ""),
            });

            // Clean up temp C executable
            if (isC && command.startsWith(rootPath)) {
              fs.unlink(command, (err) => {
                if (err) console.error("Error deleting temp exe:", err);
              });
            }
          });

          if (input) {
            child.stdin.write(input);
          }
          child.stdin.end();
          break;
        }
        case "submit": {
          const { fileName, auth, status } = data.value;
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (!workspaceFolders) {
            return;
          }

          const fileUri = vscode.Uri.joinPath(
            workspaceFolders[0].uri,
            fileName,
          );
          try {
            const contentBuffer = await vscode.workspace.fs.readFile(fileUri);
            const content = new TextDecoder().decode(contentBuffer);

            const response = await fetch(`${this._baseUrl}/submit`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${auth}`,
              },
              body: JSON.stringify({
                problemId: fileName.split(".")[0],
                solution: content,
                status: status || "FAILED",
              }),
            });

            const result = await response.json();
            if (response.ok) {
              vscode.window.showInformationMessage(
                `Submitted ${fileName} successfully!`,
              );
              this._view?.webview.postMessage({
                command: "submissionResponse",
                success: true,
                fileName,
              });
            } else {
              vscode.window.showErrorMessage(
                `Submission failed: ${result.error}`,
              );
              this._view?.webview.postMessage({
                command: "submissionResponse",
                success: false,
                fileName,
                error: result.error,
              });
            }
          } catch (err) {
            vscode.window.showErrorMessage(`Error submitting file: ${err}`);
          }
          break;
        }
      }
    });
  }

  public async logout() {
    const result = await vscode.window.showInformationMessage(
      "Are you sure you want to log out?",
      "Yes",
      "No",
    );

    if (result === "Yes") {
      await this._context.globalState.update("loginData", undefined);
      this._view?.webview.postMessage({ command: "logoutSuccess" });
      // Refresh files after logout to show local state
      await this.pullProblems(false);
    }
  }

  public async pullProblems(showMessages = true) {
    const savedAuth = this._context.globalState.get<{
      auth: string;
      username: string;
    }>("loginData");

    // Always get local files
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      this._view?.webview.postMessage({ command: "files", value: [] });
      return;
    }

    const rootUri = workspaceFolders[0].uri;
    const getLocalFiles = async () => {
      try {
        const entries = await vscode.workspace.fs.readDirectory(rootUri);
        return entries.map(([name, type]) => ({
          name,
          type: type === vscode.FileType.Directory ? "directory" : "file",
        }));
      } catch (err) {
        console.error(err);
        return [];
      }
    };

    if (!savedAuth) {
      if (showMessages)
        vscode.window.showErrorMessage("Please login first to pull problems.");
      const files = await getLocalFiles();
      this._view?.webview.postMessage({ command: "files", value: files });
      return;
    }

    try {
      const response = await fetch(`${this._baseUrl}/problems`, {
        headers: {
          Authorization: `Basic ${savedAuth.auth}`,
        },
      });

      if (response.ok) {
        const problems: any = await response.json();
        const syncedCount = await this.syncProblems(problems);

        if (showMessages && syncedCount > 0) {
          vscode.window.showInformationMessage(
            `Pulled problems. ${syncedCount} new files added.`,
          );
        }

        const files = await getLocalFiles();
        this._view?.webview.postMessage({ command: "files", value: files });
        this._view?.webview.postMessage({ command: "pullSuccess", problems });
      } else {
        if (showMessages)
          vscode.window.showErrorMessage(
            "Failed to pull problems from server.",
          );
        const files = await getLocalFiles();
        this._view?.webview.postMessage({ command: "files", value: files });
      }
    } catch (err) {
      console.error("Pull error:", err);
      if (showMessages)
        vscode.window.showErrorMessage("Server connection failed during pull.");
      const files = await getLocalFiles();
      this._view?.webview.postMessage({ command: "files", value: files });
    }
  }

  public async syncProblems(problems: any[]): Promise<number> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return 0;

    const rootUri = workspaceFolders[0].uri;
    let syncedCount = 0;

    for (const problem of problems) {
      const fileName = `${problem.id}.${problem.lang}`;
      const fileUri = vscode.Uri.joinPath(rootUri, fileName);

      try {
        // Check if file exists
        await vscode.workspace.fs.stat(fileUri);
        // If it exists, skip writing to avoid overwriting user work
      } catch {
        // File doesn't exist, create it
        const content = Buffer.from(problem.code, "utf8");
        await vscode.workspace.fs.writeFile(fileUri, content);
        syncedCount++;
      }
    }
    return syncedCount;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "home.js"),
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval';">
    <title>BugZero Sidebar</title>
</head>
<body>
    <div id="root">Loading BugZero (React)...</div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

