import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  ...(process.env.LBSIM_STANDALONE === "1" && { output: "standalone" }),
};

export default config;
