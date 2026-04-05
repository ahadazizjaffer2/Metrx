import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // SharedArrayBuffer required by DuckDB multi-threaded WASM bundle
        source: "/(.*)",
        headers: [
          // "credentialless" keeps crossOriginIsolated = true so SharedArrayBuffer
          // works for DuckDB, while also allowing credential-free cross-origin
          // fetches — required for WebLLM to download model shards from the
          // Hugging Face CDN (which does not set CORP headers).
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Cross-Origin-Opener-Policy",   value: "same-origin"    },
        ],
      },
    ];
  },

  turbopack: {},

  webpack(config, { isServer }) {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        { "@duckdb/duckdb-wasm": "commonjs @duckdb/duckdb-wasm" },
      ];
    }

    return config;
  },
};

export default nextConfig;