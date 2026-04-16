import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid experimental.turbopackFileSystemCacheForDev — persistent dev cache can
  // corrupt (SST mmap / "Failed to restore task data") after crashes or bad I/O.
};

export default nextConfig;
