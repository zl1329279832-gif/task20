#!/usr/bin/env python3
"""启动本地HTTP服务器 (Web Worker 需要 HTTP 协议加载)"""
import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

PORT = 8080
Handler = http.server.SimpleHTTPRequestHandler

print(f"""
  ╔══════════════════════════════════════╗
  ║     楼宇能耗分析系统 v1.0            ║
  ║     访问地址: http://localhost:{PORT}  ║
  ╚══════════════════════════════════════╝
""")

with http.server.HTTPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
