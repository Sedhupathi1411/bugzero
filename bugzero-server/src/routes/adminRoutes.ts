import { Router, Response, Request, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { getAllProblems } from "../lib/problems.js";

const router = Router();

const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Dashboard"');
    return res.status(401).send("Authentication required");
  }

  const [type, credentials] = authHeader.split(" ");

  if (type !== "Basic" || !credentials) {
    return res.status(401).send("Invalid authentication type");
  }

  const decoded = Buffer.from(credentials, "base64").toString("utf-8");
  const parts = decoded.split(":");
  const username = parts[0];
  const password = parts.slice(1).join(":");

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).send("Invalid admin credentials");
  }

  next();
};

router.get("/dashboard", adminAuth, async (req, res: Response) => {
  try {
    const EASY_POINTS = 5;
    const MEDIUM_POINTS = 10;
    const HARD_POINTS = 15;

    const problems = await getAllProblems();
    const problemDifficultyMap: Record<string, string> = {};
    problems.forEach(p => {
      problemDifficultyMap[p.id] = p.level.toLowerCase();
    });

    const users = await prisma.user.findMany({
      include: {
        submissions: {
          select: {
            problemId: true,
            status: true
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    const totalSubmissions = await prisma.submission.count();

    // Calculate points and prepare user data
    const userMatrixData = users.map(user => {
      const statusMap: Record<string, string> = {};
      user.submissions.forEach(s => {
        if (statusMap[s.problemId] !== 'PASSED') {
          statusMap[s.problemId] = s.status;
        }
      });

      let totalPoints = 0;
      Object.keys(statusMap).forEach(probId => {
        if (statusMap[probId] === 'PASSED') {
          const difficulty = problemDifficultyMap[probId];
          if (difficulty === 'easy') totalPoints += EASY_POINTS;
          else if (difficulty === 'medium') totalPoints += MEDIUM_POINTS;
          else if (difficulty === 'hard') totalPoints += HARD_POINTS;
        }
      });

      return {
        username: user.username,
        statusMap,
        totalPoints
      };
    });

    // Sort by points descending
    userMatrixData.sort((a, b) => b.totalPoints - a.totalPoints || a.username.localeCompare(b.username));

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="refresh" content="60">
          <title>BugZero Admin Dashboard</title>
          <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background: #f4f7f6; }
              .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; max-width: 1200px; margin-left: auto; margin-right: auto; }
              .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; max-width: 1200px; margin-left: auto; margin-right: auto; }
              .stat-card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
              .stat-card h3 { margin: 0; font-size: 0.9em; color: #666; text-transform: uppercase; }
              .stat-card p { margin: 10px 0 0; font-size: 2em; font-weight: bold; color: #2c3e50; }
              
              .table-container { width: 100%; overflow-x: auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 30px; }
              table { width: 100%; border-collapse: collapse; min-width: 800px; }
              th, td { padding: 10px 12px; text-align: center; border-bottom: 1px solid #eee; border-right: 1px solid #eee; }
              th { background: #2c3e50; color: #fff; text-transform: uppercase; font-size: 0.75em; position: sticky; top: 0; }
              
              th:first-child, td:first-child { position: sticky; left: 0; background: #fff; z-index: 2; text-align: left; font-weight: bold; border-right: 1px solid #eee; }
              th:first-child { background: #2c3e50; z-index: 3; }
              
              .points-col { background: #f8f9fa !important; font-weight: bold; color: #2c3e50; min-width: 80px; }
              th.points-col { background: #34495e !important; color: #fff; }
              
              .status-passed { color: #27ae60; font-weight: bold; font-size: 1.2em; }
              .status-failed { color: #e74c3c; font-weight: bold; font-size: 1.2em; }
              .empty { color: #ddd; }
              tr:hover td { background: #f9f9f9; }
              tr:hover td:first-child { background: #f0f4f8; }
              
              .refresh-hint { font-size: 0.8em; color: #999; text-align: right; }
          </style>
      </head>
      <body>
          <div class="header">
              <h1>BugZero Admin Dashboard</h1>
              <p class="refresh-hint">Auto-refreshing every 1m...</p>
          </div>
          
          <div class="stats">
              <div class="stat-card">
                  <h3>Total Users</h3>
                  <p>${users.length}</p>
              </div>
              <div class="stat-card">
                  <h3>Total Submissions</h3>
                  <p>${totalSubmissions}</p>
              </div>
          </div>

          <h2>User Progress Leaderboard</h2>
          <div class="table-container">
              <table>
                  <thead>
                      <tr>
                          <th>User</th>
                          <th class="points-col">Points</th>
                          ${problems.map(p => `<th>${p.id.replace(/_/g, ' ')}<br><span style="font-size: 0.8em; opacity: 0.7;">(${p.level})</span></th>`).join('')}
                      </tr>
                  </thead>
                  <tbody>
                      ${userMatrixData.map(userData => `
                          <tr>
                              <td>${userData.username}</td>
                              <td class="points-col">${userData.totalPoints}</td>
                              ${problems.map(p => {
                                const status = userData.statusMap[p.id];
                                if (!status) return '<td><span class="empty">-</span></td>';
                                if (status === 'PASSED') return '<td><span class="status-passed">✓</span></td>';
                                return '<td><span class="status-failed">✗</span></td>';
                              }).join('')}
                          </tr>
                      `).join('')}
                  </tbody>
              </table>
          </div>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).send("Internal Server Error");
  }
});

export default router;
