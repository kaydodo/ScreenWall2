#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
米家 API 服务端脚本
用于 server.js 调用，支持登录和设备控制
"""

import sys
import json
import os
from pathlib import Path

# 认证文件路径（与服务端配置一致）
AUTH_FILE = os.path.join(os.path.dirname(__file__), 'mijia-auth.json')

def init_api():
    """初始化 mijiaAPI，未安装时提示"""
    try:
        from mijiaAPI import mijiaAPI
        return mijiaAPI(AUTH_FILE)
    except ImportError:
        print(json.dumps({
            "success": False,
            "error": "mijiaAPI 未安装，请运行: pip install mijiaAPI"
        }, ensure_ascii=False))
        sys.exit(1)

def cmd_login():
    """扫码登录"""
    api = init_api()
    try:
        api.login()
        print(json.dumps({
            "success": True,
            "message": "登录成功",
            "auth_file": AUTH_FILE
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))

def cmd_status():
    """检查登录状态"""
    if not os.path.exists(AUTH_FILE):
        print(json.dumps({
            "success": False,
            "logged_in": False,
            "error": "未登录"
        }, ensure_ascii=False))
        return
    
    api = init_api()
    try:
        # 尝试获取家庭列表验证 Token 有效性
        homes = api.get_homes_list()
        print(json.dumps({
            "success": True,
            "logged_in": True,
            "homes_count": len(homes.get('homelist', []))
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "logged_in": False,
            "error": str(e)
        }, ensure_ascii=False))

def cmd_homes():
    """获取家庭列表"""
    api = init_api()
    try:
        homes = api.get_homes_list()
        print(json.dumps({
            "success": True,
            "homes": homes.get('homelist', [])
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))

def cmd_devices(home_id=None):
    """获取设备列表"""
    api = init_api()
    try:
        devices = api.get_devices_list(home_id=home_id)
        # 简化设备信息
        simple_devices = []
        for d in devices:
            simple_devices.append({
                "did": d.get("did"),
                "name": d.get("name"),
                "model": d.get("model"),
                "is_online": d.get("is_online", False)
            })
        print(json.dumps({
            "success": True,
            "devices": simple_devices
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))

def cmd_scenes(home_id=None):
    """获取场景列表"""
    api = init_api()
    try:
        scenes = api.get_scenes_list(home_id=home_id)
        # 简化场景信息
        simple_scenes = []
        for s in scenes:
            simple_scenes.append({
                "scene_id": s.get("scene_id"),
                "name": s.get("name"),
                "home_id": s.get("home_id")
            })
        print(json.dumps({
            "success": True,
            "scenes": simple_scenes
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))

def cmd_run_scene(scene_id, home_id):
    """执行场景"""
    api = init_api()
    try:
        result = api.run_scene(scene_id=scene_id, home_id=home_id)
        print(json.dumps({
            "success": True,
            "result": result
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))

def cmd_set_prop(did, siid, piid, value):
    """设置设备属性"""
    api = init_api()
    try:
        result = api.set_devices_prop({
            "did": did,
            "siid": int(siid),
            "piid": int(piid),
            "value": value
        })
        print(json.dumps({
            "success": True,
            "result": result
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=False))

def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "用法: python mijia-bridge.py <命令> [参数]"
        }, ensure_ascii=False))
        return
    
    cmd = sys.argv[1]
    
    if cmd == "login":
        cmd_login()
    elif cmd == "status":
        cmd_status()
    elif cmd == "homes":
        cmd_homes()
    elif cmd == "devices":
        home_id = sys.argv[2] if len(sys.argv) > 2 else None
        cmd_devices(home_id)
    elif cmd == "scenes":
        home_id = sys.argv[2] if len(sys.argv) > 2 else None
        cmd_scenes(home_id)
    elif cmd == "run_scene":
        if len(sys.argv) < 4:
            print(json.dumps({
                "success": False,
                "error": "用法: run_scene <scene_id> <home_id>"
            }, ensure_ascii=False))
            return
        cmd_run_scene(sys.argv[2], sys.argv[3])
    elif cmd == "set_prop":
        if len(sys.argv) < 6:
            print(json.dumps({
                "success": False,
                "error": "用法: set_prop <did> <siid> <piid> <value>"
            }, ensure_ascii=False))
            return
        cmd_set_prop(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    else:
        print(json.dumps({
            "success": False,
            "error": f"未知命令: {cmd}"
        }, ensure_ascii=False))

if __name__ == "__main__":
    main()
