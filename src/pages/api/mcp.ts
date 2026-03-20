import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import type { NextApiRequest, NextApiResponse } from "next";

const VERKADA_API_KEY = process.env.VERKADA_API_KEY;

const server = new Server(
  { name: "verkada-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 1. AI에게 내가 가진 도구 목록을 알려줍니다.
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_cameras",
        description: "조직 내 모든 Verkada 카메라 목록을 조회합니다.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "get_camera_snapshot",
        description: "특정 카메라의 실시간 스냅샷을 가져옵니다.",
        inputSchema: {
          type: "object",
          properties: { camera_id: { type: "string", description: "카메라의 고유 ID" } },
          required: ["camera_id"]
        }
      }
    ]
  };
});

// 2. 도구 실행 로직입니다.
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!VERKADA_API_KEY) {
    throw new Error("API 키가 설정되지 않았습니다.");
  }

  const { name, arguments: args } = request.params;

  try {
    if (name === "list_cameras") {
      const response = await axios.get("https://api.verkada.com/core/v1/cameras", {
        headers: { "x-api-key": VERKADA_API_KEY }
      });
      return { content: [{ type: "text", text: JSON.stringify(response.data.cameras, null, 2) }] };
    }

    if (name === "get_camera_snapshot") {
      const camera_id = (args as any).camera_id;
      const response = await axios.get(`https://api.verkada.com/core/v1/cameras/snapshot?camera_id=${camera_id}`, {
        headers: { "x-api-key": VERKADA_API_KEY }
      });
      return { content: [{ type: "text", text: `스냅샷 URL: ${response.data.url}` }] };
    }

    throw new Error(`알 수 없는 도구: ${name}`);
  } catch (error: any) {
    return { isError: true, content: [{ type: "text", text: `오류 발생: ${error.message}` }] };
  }
});

let transport: SSEServerTransport | null = null;

// 서버리스 환경 충돌 방지 설정
export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

// 3. Vercel 통신 엔드포인트
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    // 클라이언트가 처음 연결할 때
    transport = new SSEServerTransport("/api/mcp", res as any);
    await server.connect(transport);
    
    req.on("close", () => {
      transport = null;
    });
  } else if (req.method === "POST") {
    // 클라이언트가 명령을 보낼 때
    if (!transport) {
      res.status(400).json({ error: "SSE 연결이 없습니다." });
      return;
    }
    try {
      await transport.handlePostMessage(req as any, res as any);
    } catch (error) {
      res.status(500).json({ error: "메시지 처리 실패" });
    }
  } else {
    res.status(405).json({ error: "Method Not Allowed" });
  }
}