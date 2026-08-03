declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination: string;
      filename: string;
      path: string;
      buffer: Buffer;
    }
  }

  interface Request {
    // 由 validateRequest({ query: ... }) 寫入：已經過 Zod parse/transform/coerce 的
    // query 結果（例如 limit/page 已轉成 number），型別由各 controller 用
    // `z.infer<typeof someSchema>` 自行窄化，這裡只保留最寬鬆的 unknown 容器。
    validatedQuery?: unknown;
  }
}
