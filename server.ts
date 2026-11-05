import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

async function startServer() {
  const app = express();
  app.use(express.json());

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  app.post('/api/generate-mindprint', async (req, res) => {
    try {
      const { profileText, profileTitle } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      }

      const ai = new GoogleGenAI({ apiKey });

      const prompt = `You are a cognitive psychology and behavioral forensics expert.
Analyze the following profile/bio/resume/description and generate a structured 3D Mindprint Neural Network JSON dataset mapped inside an anatomical 3D human brain.
Subject Profile Title: "${profileTitle || 'Subject'}"
Profile Content: "${profileText}"

Return valid JSON with the following structure:
{
  "title": "THINKING CORE",
  "subtitle": "Strongest observed themes summary",
  "coreOverview": "Detailed paragraph on strongest observed themes, decision speed, operational execution style, and cognitive operating style.",
  "unlockedQuestions": [
    "Question 1 that unlocks deeper understanding",
    "Question 2 that unlocks deeper understanding"
  ],
  "nodes": [
    {
      "id": "node-1",
      "label": "Short 2-word label (e.g. Thinking Core, Decision spee...)",
      "fullTitle": "Full descriptive pattern title",
      "region": "Anatomical brain region (e.g. Dorsolateral Prefrontal Cortex, Superior Parietal Lobule, Anterior Temporal Lobe, Cerebellum, Brainstem)",
      "category": "How they think" | "Decisions" | "Trust" | "Expressed drivers" | "Workplace friction" | "Deeper hypotheses" | "Work events",
      "x": number (between -1.6 and 1.5),
      "y": number (between -1.25 and 1.0),
      "z": number (between -0.75 and 0.75),
      "significance": "High" | "Medium" | "Core",
      "description": "Evidence-backed pattern description explaining why this node exists.",
      "citations": number (5 to 36),
      "connections": ["node-2", "node-3"]
    }
  ]
}
Ensure exactly one node has significance "Core" and label "Thinking Core". Generate between 14 and 17 nodes with interconnected links.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('No response generated from Gemini.');
      }

      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const mindprintData = JSON.parse(cleanText);

      res.json(mindprintData);
    } catch (error: any) {
      console.error('Error generating mindprint:', error);
      res.status(500).json({ error: error.message || 'Failed to generate mindprint' });
    }
  });

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
