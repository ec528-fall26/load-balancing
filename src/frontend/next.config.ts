import type { NextConfig } from "next";

const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  ...(process.env.LBSIM_STANDALONE === "1" && { output: "standalone" }),
};

export default config;
