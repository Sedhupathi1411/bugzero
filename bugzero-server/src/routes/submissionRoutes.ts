import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.js";
import { AuthenticatedRequest } from "../types/index.js";

const router = Router();

router.post("/submit", authMiddleware, async (req, res: Response) => {
  const { username } = req as AuthenticatedRequest;
  const { problemId, solution, status } = req.body as {
    problemId?: string;
    solution?: string;
    status?: string;
  };

  console.log(`Submission attempt: user=${username}, problemId=${problemId}, status=${status}`);

  if (!problemId || !solution) {
    return res
      .status(400)
      .json({ error: "problemId and solution are required" });
  }

  try {
    const user = await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username },
    });

    console.log(`User resolved: id=${user.id}`);

    const submission = await prisma.submission.create({
      data: {
        problemId,
        solution,
        status: status || "FAILED",
        userId: user.id,
      },
    });

    console.log(`Submission created: id=${submission.id}`);
    res.json({ message: "Submission successful", submission });
  } catch (error) {
    console.error("Submission error details:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to store submission";
    res.status(500).json({ error: errorMessage });
  }
});

router.get("/my-submissions", authMiddleware, async (req, res: Response) => {
  const { username } = req as AuthenticatedRequest;

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { submissions: { orderBy: { createdAt: "desc" } } },
    });

    res.json(user?.submissions || []);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

export default router;
