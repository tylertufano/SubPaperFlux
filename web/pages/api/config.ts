import type { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const apiBase = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || ''
  res.status(200).json({ apiBase })
}

