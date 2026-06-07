# ScreenWall2 脚本编辑器方案设计

## 一、整体架构

### 1.1 核心设计理念

**录制优先 + 可视化编辑 + Python兜底**

参考按键精灵的设计理念，但要有创新：
- ✅ 界面更现代（Web端）
- ✅ 多设备同时控制
- ✅ Server端统一调度
- ✅ Python代码兜底（更强大）
- ✅ 支持内存注入（高级功能）

---

## 二、界面设计

### 2.1 主界面布局

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ScreenWall2 脚本编辑器 v1.0                                                    │
├─────────────────┬─────────────────────────────────────────────────────────────┤
│  设备选择        │  主编辑区（可视化）                                          │
│  ┌───────────┐ │  ┌─────────────────────────────────────────┐              │
│  │ [设备A] ✓ │ │  │ 1. [点击] 坐标 (300, 200)  "点击登录"     │              │
│  │ [设备B]   │ │  │ 2. [等待] 300ms                           │              │
│  │ [设备C]   │ │  │ 3. [条件] 图片存在 [取样图]                │              │
│  └───────────┘ │  │ 4. [输入] "abc"                           │              │
│                 │  │ 5. [循环] 3次                             │              │
│  脚本列表        │  └─────────────────────────────────────────┘              │
│  ┌───────────┐ ├─────────────────────────────────────────────────────────────┤
│  │ 登录脚本  │ │  属性面板                    │  预览/代码                      │
│  │ 日常脚本  │ │  ┌───────────────────────┐ │ ┌─────────────────────────┐   │
│  │ 副本脚本  │ │  │ 坐标: (300, 200)      │ │ │ Python预览:             │   │
│  └───────────┘ │  │ 偏移: (15, 25)        │ │ │ click(315, 225)         │   │
│                 │  │ 窗口: 角色1           │ │ │ wait(0.3)               │   │
│  组件面板        │  │ 超时: 500ms          │ │ │                         │   │
│  ┌───────────┐ │  └───────────────────────┘ │ └─────────────────────────┘   │
│  │ [点击]    │ │                                                               │
│  │ [等待]    │ │  ┌─────────────────────────────────────────────────────────┐ │
│  │ [条件]    │ │  │  [开始录制]  [停止录制]  [保存]  [执行]  [偏移计算]     │ │
│  │ [循环]    │ │  └─────────────────────────────────────────────────────────┘ │
│  │ [输入]    │ │                                                               │
│  │ [截图]    │ │                                                               │
│  │ [拖动]    │ │                                                               │
│  └───────────┘ │                                                               │
└─────────────────┴─────────────────────────────────────────────────────────────┘
```

---

## 三、脚本格式设计

### 3.1 JSON格式（简单易扩展）

```json
{
  "name": "梦幻西游自动登录",
  "version": "1.0",
  "description": "自动登录梦幻西游游戏",
  
  "offset": {
    "enabled": true,
    "offset_x": 15,
    "offset_y": 25,
    "note": "梦幻西游游戏窗口偏移"
  },
  
  "delay": {
    "mode": "random",
    "randomMin": 50,
    "randomMax": 300
  },
  
  "windows": [
    {
      "id": 1,
      "title": "梦幻西游 - 角色1",
      "offset_x": 15,
      "offset_y": 25
    },
    {
      "id": 2,
      "title": "梦幻西游 - 角色2",
      "offset_x": 18,
      "offset_y": 28
    }
  ],
  
  "steps": [
    {
      "type": "click",
      "window_id": 1,
      "x": 300,
      "y": 200,
      "comment": "点击登录按钮",
      "delay": 150
    },
    {
      "type": "wait",
      "ms": 500
    },
    {
      "type": "condition",
      "condition": "image_exists",
      "image": "data:image/png;base64,...",
      "timeout": 5000,
      "then": [
        {
          "type": "click",
          "x": 400,
          "y": 300,
          "comment": "确认登录"
        }
      ],
      "else": [
        {
          "type": "wait",
          "ms": 1000
        }
      ]
    },
    {
      "type": "loop",
      "times": 3,
      "steps": [
        {
          "type": "click",
          "x": 500,
          "y": 400,
          "comment": "完成任务"
        }
      ]
    },
    {
      "type": "input",
      "text": "abc",
      "delay": 100
    },
    {
      "type": "switch_window",
      "target_window_id": 2
    },
    {
      "type": "image_sample",
      "x": 100,
      "y": 200,
      "width": 50,
      "height": 50,
      "name": "登录按钮"
    }
  ]
}
```

### 3.2 组件类型说明

| 组件类型 | 参数 | 说明 |
|---------|------|------|
| click | x, y, window_id | 点击指定坐标 |
| wait | ms | 等待指定毫秒 |
| condition | image, timeout, then[], else[] | 图片条件判断 |
| loop | times, steps[] | 循环执行 |
| input | text | 输入文本 |
| switch_window | target_window_id | 切换游戏窗口 |
| image_sample | x, y, width, height, name | 取样截图 |
| drag | x1, y1, x2, y2, duration | 拖动操作 |
| scroll | delta | 鼠标滚轮 |
| key_press | key | 按键 |

---

## 四、录制功能设计

### 4.1 延迟设置选项

```json
{
  "delay": {
    "mode": "random",  // 可选: "fixed" | "random" | "smart" | "none"
    "fixedMs": 100,
    "randomMin": 50,
    "randomMax": 300,
    "smartConfig": {
      "clickDelay": 100,
      "waitDelay": 500,
      "inputDelay": 200
    }
  }
}
```

| 模式 | 说明 | 推荐场景 |
|------|------|---------|
| none | 不添加延迟 | 快速执行 |
| fixed | 固定延迟 | 稳定环境 |
| random | 随机延迟 [min-max] | 模拟真人 | ✅ 默认 |
| smart | 根据操作类型智能延迟 | 进阶用户 |

### 4.2 录制流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  录制流程                                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. 录制前设置                                                                │
│     ├─ 选择要操作的设备窗口                                                    │
│     ├─ 确认/计算偏移量                                                       │
│     └─ 点击"开始录制"                                                        │
│                                                                              │
│  2. 录制中                                                                    │
│     ├─ 用户在预览页面点击游戏内位置                                           │
│     ├─ 客户端自动应用偏移量                                                   │
│     ├─ 记录：                                                                  │
│     │   ├─ 时间戳（用于计算延迟）                                             │
│     │   ├─ 坐标 (x, y)                                                       │
│     │   ├─ 鼠标偏移量 (offset_x, offset_y) ← 关键！                          │
│     │   ├─ 窗口ID                                                             │
│     │   └─ 截图（可选，用于后续验证）                                         │
│     └─ Server整合所有操作 → 生成JSON脚本                                      │
│                                                                              │
│  3. 录制后                                                                    │
│     ├─ 可视化编辑                                                            │
│     ├─ 添加注释                                                              │
│     ├─ 调整参数                                                              │
│     └─ 保存/执行                                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 客户端录制模块

```python
class ScriptRecorder:
    """脚本录制器"""
    
    def __init__(self):
        self.recording = False
        self.steps = []
        self.last_timestamp = 0
        self.current_offset = (0, 0)
        self.current_window_id = None
    
    def start_recording(self, window_id=None, offset=(0, 0)):
        """开始录制"""
        self.recording = True
        self.steps = []
        self.last_timestamp = time.time()
        self.current_window_id = window_id
        self.current_offset = offset
        print("[录制] 开始录制")
    
    def record_click(self, x, y, window_id=None):
        """记录点击操作"""
        if not self.recording:
            return
        
        now = time.time()
        delay = int((now - self.last_timestamp) * 1000)
        
        # 应用偏移量：记录的是真实坐标
        actual_x = x + self.current_offset[0]
        actual_y = y + self.current_offset[1]
        
        step = {
            "type": "click",
            "x": actual_x,
            "y": actual_y,
            "window_id": window_id or self.current_window_id,
            "delay": delay,
            "timestamp": now
        }
        
        self.steps.append(step)
        self.last_timestamp = now
        print(f"[录制] 点击: ({actual_x}, {actual_y}) 延迟: {delay}ms")
    
    def record_wait(self, ms):
        """记录等待操作"""
        if not self.recording:
            return
        
        step = {
            "type": "wait",
            "ms": ms
        }
        self.steps.append(step)
        print(f"[录制] 等待: {ms}ms")
    
    def record_input(self, text):
        """记录输入操作"""
        if not self.recording:
            return
        
        now = time.time()
        delay = int((now - self.last_timestamp) * 1000)
        
        step = {
            "type": "input",
            "text": text,
            "window_id": self.current_window_id,
            "delay": delay
        }
        
        self.steps.append(step)
        self.last_timestamp = now
        print(f"[录制] 输入: {text}")
    
    def stop_recording(self):
        """停止录制"""
        self.recording = False
        print(f"[录制] 停止录制，共 {len(self.steps)} 步")
        return self.steps
    
    def export_json(self):
        """导出为JSON格式"""
        return {
            "steps": self.steps,
            "offset": {
                "offset_x": self.current_offset[0],
                "offset_y": self.current_offset[1]
            },
            "window_id": self.current_window_id
        }
```

---

## 五、偏移量计算方案

### 5.1 问题分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  核心问题：预览页面无法获取真实偏移量                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  预览页面看到的画面：                                                         │
│  ├─ 是服务端转发的截图                                                       │
│  ├─ 没有真实鼠标指针                                                         │
│  ├─ 点击时发送的是显示坐标                                                   │
│  └─ 无法知道实际需要加/减多少偏移                                             │
│                                                                              │
│  需要的偏移量：                                                               │
│  ├─ 真实鼠标位置 vs 游戏显示的鼠标指针位置                                     │
│  ├─ 这两个位置的差值就是偏移量                                                │
│  └─ 只有在本地游戏窗口上才能准确获取                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 偏移量计算流程（客户端本地）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  偏移量初始化向导（4步）                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  步骤 1/4：进入游戏                                                          │
│  ├─ 请确保游戏窗口已打开                                                     │
│  ├─ 切换到需要操作的角色                                                     │
│  └─ [下一步]                                                                │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  步骤 2/4：放置鼠标到参考点                                                  │
│  ├─ 请将鼠标移到游戏窗口内的参考点                                           │
│  │   （如窗口左上角，或某个固定的图标位置）                                    │
│  ├─ 真实鼠标位置: (100, 100)                                                │
│  └─ [确认当前位置]  [上一步]  [下一步]                                       │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  步骤 3/4：框选游戏鼠标图标                                                  │
│  ├─ 请在下方截图中框选游戏显示的自定义鼠标图标                               │
│  │                                                                            │
│  │   ┌─────────────────────────────────────┐                                 │
│  │   │                                     │                                 │
│  │   │         [游戏截图预览]               │                                 │
│  │   │                                     │                                 │
│  │   │         ┌──────┐                    │                                 │
│  │   │         │  ⚔   │ ← 用户框选这里    │                                 │
│  │   │         └──────┘                    │                                 │
│  │   └─────────────────────────────────────┘                                 │
│  │                                                                            │
│  └─ [重新截图]  [上一步]  [下一步]                                           │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  步骤 4/4：确认偏移量                                                        │
│  ├─ 偏移量计算完成！                                                         │
│  │                                                                            │
│  │   X轴偏移: +15 像素                                                       │
│  │   Y轴偏移: +25 像素                                                       │
│  │                                                                            │
│  └─ [测试偏移]  [重新初始化]  [完成]                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 客户端偏移计算模块

```python
class OffsetCalculator:
    """游戏鼠标偏移量计算器"""
    
    def __init__(self):
        self.game_hwnd = None
        self.offset_x = 0
        self.offset_y = 0
        self.mouse_template = None  # 鼠标指针模板
    
    def load_mouse_template(self, template_path):
        """加载鼠标指针模板"""
        self.mouse_template = cv2.imread(template_path, cv2.IMREAD_COLOR)
    
    def calculate_offset(self, game_window_title):
        """
        计算游戏鼠标偏移量
        """
        # 1. 找到游戏窗口
        self.game_hwnd = win32gui.FindWindow(None, game_window_title)
        if not self.game_hwnd:
            raise Exception(f"找不到游戏窗口: {game_window_title}")
        
        # 2. 获取游戏窗口位置
        left, top, right, bottom = win32gui.GetWindowRect(self.game_hwnd)
        game_width = right - left
        game_height = bottom - top
        
        print(f"游戏窗口: {left}, {top}, {right}, {bottom}")
        print(f"窗口大小: {game_width}x{game_height}")
        
        # 3. 移动真实鼠标到窗口中心
        center_x = left + game_width // 2
        center_y = top + game_height // 2
        win32api.SetCursorPos((center_x, center_y))
        time.sleep(0.1)
        
        # 4. 截图游戏窗口
        screenshot = self.capture_window(self.game_hwnd)
        
        # 5. 在截图中查找鼠标指针位置
        mouse_pos_in_screenshot = self.find_mouse_pointer(screenshot)
        
        # 6. 计算偏移量
        #    真实鼠标在窗口内的位置
        real_x_in_window = center_x - left
        real_y_in_window = center_y - top
        
        #    游戏显示的鼠标位置
        display_x = mouse_pos_in_screenshot[0]
        display_y = mouse_pos_in_screenshot[1]
        
        #    偏移量 = 显示位置 - 真实位置
        self.offset_x = display_x - real_x_in_window
        self.offset_y = display_y - real_y_in_window
        
        print(f"偏移量计算完成: offset_x={self.offset_x}, offset_y={self.offset_y}")
        return self.offset_x, self.offset_y
    
    def find_mouse_pointer(self, screenshot):
        """
        在截图中查找鼠标指针位置
        使用模板匹配
        """
        if self.mouse_template is None:
            # 如果没有模板，使用默认的颜色特征识别
            # 鼠标指针通常是白色/彩色的
            # 这里需要根据实际情况调整
            pass
        
        # 模板匹配
        result = cv2.matchTemplate(screenshot, self.mouse_template, cv2.TM_CCOEFF_NORMED)
        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
        
        if max_val > 0.8:  # 匹配度阈值
            mouse_x = max_loc[0] + self.mouse_template.shape[1] // 2
            mouse_y = max_loc[1] + self.mouse_template.shape[0] // 2
            return (mouse_x, mouse_y)
        else:
            raise Exception("无法在截图中找到鼠标指针")
    
    def capture_window(self, hwnd):
        """截取指定窗口"""
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        width = right - left
        height = bottom - top
        
        hwndDC = win32gui.GetWindowDC(hwnd)
        mfcDC = win32ui.CreateDCFromHandle(hwndDC)
        saveDC = mfcDC.CreateCompatibleDC()
        
        saveBitMap = win32ui.CreateBitmap()
        saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
        saveDC.SelectObject(saveBitMap)
        
        result = windll.user32.PrintWindow(hwnd, saveDC.GetSafeHdc(), 0)
        
        bmpinfo = saveBitMap.GetInfo()
        bmpstr = saveBitMap.GetBitmapBits(True)
        
        im = Image.frombuffer(
            'RGB',
            (bmpinfo['bmWidth'], bmpinfo['bmHeight']),
            bmpstr, 'raw', 'BGRX', 0, 1
        )
        
        win32gui.DeleteObject(saveBitMap.GetHandle())
        saveDC.DeleteDC()
        mfcDC.DeleteDC()
        win32gui.ReleaseDC(hwnd, hwndDC)
        
        return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    
    def save_config(self, config_path):
        """保存偏移量配置"""
        config = {
            "offset_x": self.offset_x,
            "offset_y": self.offset_y,
            "game_hwnd": self.game_hwnd
        }
        with open(config_path, 'w') as f:
            json.dump(config, f)
    
    def load_config(self, config_path):
        """加载偏移量配置"""
        with open(config_path, 'r') as f:
            config = json.load(f)
        self.offset_x = config["offset_x"]
        self.offset_y = config["offset_y"]
        self.game_hwnd = config.get("game_hwnd")
```

### 5.4 偏移量应用机制

```python
def execute_click_with_offset(x, y, offset_x=0, offset_y=0):
    """
    使用偏移量执行点击
    
    参数:
        x, y: 脚本中记录的坐标（显示坐标）
        offset_x, offset_y: 偏移量
    """
    # 方案A: 脚本记录的是显示坐标，执行时需要减去偏移
    actual_x = x - offset_x
    actual_y = y - offset_y
    
    # 方案B: 脚本记录的是真实坐标，执行时直接使用
    # actual_x = x
    # actual_y = y
    
    # 推荐方案A，更符合用户直觉（用户在预览上看到的坐标就是脚本记录的坐标）
    
    mouse_click(actual_x, actual_y)
    print(f"点击: 脚本坐标({x}, {y}) + 偏移({offset_x}, {offset_y}) = 实际坐标({actual_x}, {actual_y})")
```

---

## 六、内存注入方案（高级功能）

### 6.1 为什么需要内存注入？

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  普通方式 vs 内存注入                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  普通方式（远控）：                                                             │
│  ├─ 通过WebSocket发送点击指令                                                  │
│  ├─ 客户端执行 mouse_event                                                    │
│  ├─ 游戏检测到鼠标消息                                                        │
│  ├─ 问题：可能被游戏检测为外挂                                                │
│  └─ 问题：鼠标移动可能被监控                                                  │
│                                                                              │
│  内存注入方式：                                                                │
│  ├─ 直接操作游戏进程内存                                                      │
│  ├─ 修改游戏内部的鼠标坐标                                                     │
│  ├─ 游戏以为是正常鼠标输入                                                    │
│  ├─ 不容易被检测                                                              │
│  └─ 可以实现更精确的坐标控制                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 内存注入实现思路

```python
class GameMemoryInjector:
    """
    游戏内存注入器
    高级功能，用于更精确的鼠标控制
    """
    
    def __init__(self):
        self.process_name = "xyq.exe"  # 梦幻西游进程名
        self.process_handle = None
        self.mouse_x_addr = None  # 游戏内鼠标X坐标内存地址
        self.mouse_y_addr = None  # 游戏内鼠标Y坐标内存地址
        self.connected = False
    
    def attach_to_game(self):
        """
        附加到游戏进程
        """
        import ctypes
        
        # 1. 查找游戏进程
        snapshot = win32process.CreateToolhelp32Snapshot(
            win32con.TH32CS_SNAPPROCESS, 0
        )
        for proc in win32process.Process32Next(snapshot):
            if proc.szExeFile == self.process_name:
                pid = proc.th32ProcessID
                print(f"找到游戏进程: {self.process_name} (PID: {pid})")
                break
        else:
            raise Exception(f"找不到进程: {self.process_name}")
        
        # 2. 打开进程
        self.process_handle = win32api.OpenProcess(
            win32con.PROCESS_ALL_ACCESS, False, pid
        )
        
        # 3. 找到鼠标坐标的内存地址
        #    这部分需要使用 Cheat Engine 或 x64dbg 逆向分析
        #    预先确定游戏的鼠标坐标内存地址
        self.mouse_x_addr = self._find_mouse_x_address()
        self.mouse_y_addr = self._find_mouse_y_address()
        
        self.connected = True
        print(f"已连接到游戏内存")
    
    def _find_mouse_x_address(self):
        """
        查找游戏内鼠标X坐标的内存地址
        
        这部分需要预先使用Cheat Engine分析:
        1. 打开游戏，移动鼠标，观察哪些内存地址的值在变化
        2. 找到存储鼠标X坐标的地址
        3. 可能需要使用指针扫描找到稳定的指针
        """
        # 示例地址（需要根据实际游戏确定）
        # 可能是: 基址 + 偏移1 + 偏移2 + ...
        return 0x12345678
    
    def _find_mouse_y_address(self):
        """查找游戏内鼠标Y坐标的内存地址"""
        return 0x1234567C
    
    def set_mouse_position(self, x, y):
        """
        直接设置游戏内的鼠标坐标
        """
        if not self.connected:
            raise Exception("未连接到游戏进程")
        
        import struct
        
        # 1. 写入鼠标X坐标
        win32process.WriteProcessMemory(
            self.process_handle,
            self.mouse_x_addr,
            struct.pack('i', int(x)),
            4
        )
        
        # 2. 写入鼠标Y坐标
        win32process.WriteProcessMemory(
            self.process_handle,
            self.mouse_y_addr,
            struct.pack('i', int(y)),
            4
        )
        
        print(f"内存注入: 设置鼠标坐标为 ({x}, {y})")
    
    def click_at(self, x, y):
        """
        在指定坐标执行点击（内存注入方式）
        """
        # 1. 设置鼠标位置到目标坐标
        self.set_mouse_position(x, y)
        
        # 2. 触发点击事件
        #    方式A: 模拟鼠标按下/弹起
        #    方式B: 直接调用游戏的点击处理函数
        self._trigger_left_click()
    
    def _trigger_left_click(self):
        """
        触发鼠标左键点击
        
        这部分也需要逆向分析游戏的点击处理逻辑
        """
        # 示例：调用游戏的点击处理函数
        # click_handler_addr = 0x00401000
        # ctypes.windll.kernel32.CreateRemoteThread(
        #     self.process_handle, None, 0,
        #     click_handler_addr, None, 0, None
        # )
        pass
    
    def disconnect(self):
        """断开与游戏进程的连接"""
        if self.process_handle:
            win32api.CloseHandle(self.process_handle)
            self.process_handle = None
            self.connected = False
            print("已断开游戏内存连接")
```

### 6.3 内存地址查找方法

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  查找游戏鼠标坐标内存地址（使用Cheat Engine）                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  工具：Cheat Engine / x64dbg                                                 │
│                                                                              │
│  步骤：                                                                       │
│  1. 打开游戏，使用Cheat Engine附加到游戏进程                                  │
│  2. 移动鼠标，观察哪些内存地址的值在变化                                       │
│  3. 找到存储鼠标X坐标的地址，记录下来                                         │
│  4. 找到存储鼠标Y坐标的地址，记录下来                                         │
│  5. 可能需要多次测试确保地址正确                                              │
│  6. 将地址写入代码中                                                         │
│                                                                              │
│  注意事项：                                                                  │
│  - 游戏更新后地址可能变化                                                     │
│  - 可能需要使用"指针扫描"找到稳定的指针                                        │
│  - 地址可能是动态的，需要基址+偏移的方式                                       │
│  - 地址可能需要定期更新（游戏更新后）                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 七、多窗口支持

### 7.1 每个窗口独立的配置

```json
{
  "name": "梦幻西游多开脚本",
  "version": "1.0",
  
  "windows": [
    {
      "id": 1,
      "title": "梦幻西游 - 角色1",
      "offset_x": 15,
      "offset_y": 25,
      "color": "#FF5733"
    },
    {
      "id": 2,
      "title": "梦幻西游 - 角色2",
      "offset_x": 15,
      "offset_y": 25,
      "color": "#33FF57"
    },
    {
      "id": 3,
      "title": "梦幻西游 - 角色3",
      "offset_x": 18,
      "offset_y": 28,
      "color": "#3357FF"
    }
  ],
  
  "steps": [
    {
      "type": "switch_window",
      "target_window_id": 1
    },
    {
      "type": "click",
      "window_id": 1,
      "x": 300,
      "y": 200,
      "comment": "在角色1窗口点击NPC"
    },
    {
      "type": "wait",
      "ms": 500
    },
    {
      "type": "switch_window",
      "target_window_id": 2
    },
    {
      "type": "click",
      "window_id": 2,
      "x": 400,
      "y": 300,
      "comment": "在角色2窗口点击NPC"
    }
  ]
}
```

### 7.2 多窗口控制器

```python
class MultiWindowController:
    """
    多窗口脚本控制器
    """
    
    def __init__(self):
        self.windows = {}
        self.current_window = None
        self.offset_calculator = OffsetCalculator()
        self.memory_injector = GameMemoryInjector()
    
    def add_window(self, window_id, title, offset_x, offset_y, color="#000000"):
        """
        添加游戏窗口
        """
        try:
            hwnd = win32gui.FindWindow(None, title)
            if not hwnd:
                raise Exception(f"找不到窗口: {title}")
            
            rect = win32gui.GetWindowRect(hwnd)
            
            self.windows[window_id] = {
                'hwnd': hwnd,
                'rect': rect,
                'offset_x': offset_x,
                'offset_y': offset_y,
                'color': color,
                'base_x': rect[0],
                'base_y': rect[1],
                'width': rect[2] - rect[0],
                'height': rect[3] - rect[1]
            }
            
            print(f"添加窗口 [{window_id}] {title}: 位置{rect}, 偏移({offset_x}, {offset_y})")
            
        except Exception as e:
            print(f"添加窗口失败 [{window_id}] {title}: {e}")
    
    def switch_to_window(self, window_id):
        """
        切换到指定窗口
        """
        if window_id not in self.windows:
            raise Exception(f"窗口不存在: {window_id}")
        
        self.current_window = self.windows[window_id]
        hwnd = self.current_window['hwnd']
        
        # 激活窗口
        win32gui.SetForegroundWindow(hwnd)
        time.sleep(0.1)
        
        # 确保窗口在最前
        win32gui.BringWindowToTop(hwnd)
        
        print(f"切换到窗口 [{window_id}]")
    
    def click_at(self, x, y, window_id=None, use_memory_inject=False):
        """
        在指定坐标点击
        
        参数:
            x, y: 窗口内的相对坐标
            window_id: 窗口ID（如果为None，使用当前窗口）
            use_memory_inject: 是否使用内存注入
        """
        if window_id:
            self.switch_to_window(window_id)
        
        if not self.current_window:
            raise Exception("没有活动的窗口")
        
        # 计算屏幕坐标
        base_x = self.current_window['base_x']
        base_y = self.current_window['base_y']
        offset_x = self.current_window['offset_x']
        offset_y = self.current_window['offset_y']
        
        # 屏幕坐标 = 窗口位置 + 相对坐标 + 偏移
        screen_x = base_x + x + offset_x
        screen_y = base_y + y + offset_y
        
        if use_memory_inject and self.memory_injector.connected:
            # 使用内存注入
            self.memory_injector.click_at(x, y)
        else:
            # 普通方式
            win32api.SetCursorPos((screen_x, screen_y))
            time.sleep(0.01)
            win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
            time.sleep(0.05)
            win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        
        print(f"点击: 窗口({x}, {y}) + 偏移({offset_x}, {offset_y}) = 屏幕({screen_x}, {screen_y})")
    
    def execute_script(self, script_data, use_memory_inject=False):
        """
        执行脚本
        """
        for step in script_data['steps']:
            step_type = step['type']
            
            if step_type == 'click':
                self.click_at(
                    step['x'],
                    step['y'],
                    step.get('window_id'),
                    use_memory_inject
                )
                
            elif step_type == 'wait':
                time.sleep(step['ms'] / 1000)
                
            elif step_type == 'switch_window':
                self.switch_to_window(step['target_window_id'])
                
            elif step_type == 'input':
                # 文本输入
                send_keys(step['text'])
            
            elif step_type == 'loop':
                for _ in range(step['times']):
                    self.execute_script({'steps': step['steps']}, use_memory_inject)
            
            # ... 其他类型
            
            time.sleep(step.get('delay', 100) / 1000)
```

---

## 八、执行架构

### 8.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ScreenWall2 脚本系统架构                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Web端（脚本编辑器）                                                  │    │
│  │  ├─ 脚本编辑界面                                                     │    │
│  │  ├─ 设备预览                                                        │    │
│  │  ├─ 录制控制                                                        │    │
│  │  └─ 偏移量计算向导                                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Server端                                                             │    │
│  │  ├─ 脚本管理器                                                        │    │
│  │  │   ├─ JSON解析                                                      │    │
│  │  │   ├─ 状态管理                                                      │    │
│  │  │   └─ 进度报告                                                      │    │
│  │  ├─ 截图判定引擎                                                      │    │
│  │  │   ├─ 图片对比                                                      │    │
│  │  │   ├─ 相似度计算                                                    │    │
│  │  │   └─ 条件判断                                                      │    │
│  │  └─ 执行调度器                                                        │    │
│  │      ├─ 按步骤发送指令                                                 │    │
│  │      ├─ 处理等待/循环                                                  │    │
│  │      └─ 返回执行结果                                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│                    ┌───────────────┼───────────────┐                       │
│                    ▼               ▼               ▼                       │
│  ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────┐  │
│  │  客户端A（设备1）     │ │  客户端B（设备2）      │ │  客户端C（设备3） │  │
│  │  ├─ 接收远控指令      │ │  ├─ 接收远控指令      │ │  ├─ 接收远控指令 │  │
│  │  ├─ 执行点击/输入     │ │  ├─ 执行点击/输入     │ │  ├─ 执行点击/输入│  │
│  │  ├─ 提供截图         │ │  ├─ 提供截图         │ │  ├─ 提供截图    │  │
│  │  ├─ 偏移计算模块     │ │  ├─ 偏移计算模块     │ │  ├─ 偏移计算模块│  │
│  │  └─ 内存注入模块     │ │  └─ 内存注入模块     │ │  └─ 内存注入模块│  │
│  └──────────────────────┘ └──────────────────────┘ └──────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 执行流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  脚本执行完整流程                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. 初始化（一次性）                                                          │
│     ├─ 打开游戏窗口                                                          │
│     ├─ 启动内存注入（可选）                                                  │
│     ├─ 计算偏移量                                                            │
│     └─ 保存配置                                                              │
│                                                                              │
│  2. 脚本加载                                                                 │
│     ├─ Server读取JSON脚本                                                    │
│     ├─ 解析步骤序列                                                          │
│     └─ 初始化执行状态                                                        │
│                                                                              │
│  3. 执行步骤                                                                 │
│     ├─ 切换窗口（如需要）                                                    │
│     ├─ Server发送指令到客户端                                                │
│     │   ├─ 普通模式: {type: 'click', x: 100, y: 200, window_id: 1}         │
│     │   └─ 内存注入: {type: 'mem_click', x: 100, y: 200}                   │
│     ├─ 客户端执行:                                                           │
│     │   ├─ 读取偏移量                                                        │
│     │   ├─ 计算真实坐标                                                      │
│     │   └─ 执行点击/内存注入                                                 │
│     ├─ 等待（如有）                                                          │
│     └─ 条件判断（如有）: Server请求截图 → 判定 → 决定下一步                  │
│                                                                              │
│  4. 执行完成                                                                 │
│     ├─ 返回执行结果                                                          │
│     └─ 生成执行日志                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Server端模块

```javascript
// server/script-manager.js
class ScriptManager {
    constructor() {
        this.activeScripts = new Map();  // deviceId -> script execution state
        this.scriptLibrary = new Map();  // scriptName -> script data
    }
    
    // 加载脚本
    loadScript(scriptData) {
        const scriptId = this.generateId();
        this.scriptLibrary.set(scriptId, scriptData);
        return scriptId;
    }
    
    // 执行脚本
    async executeScript(scriptId, deviceId) {
        const script = this.scriptLibrary.get(scriptId);
        if (!script) {
            throw new Error(`Script not found: ${scriptId}`);
        }
        
        const state = {
            scriptId,
            deviceId,
            currentStep: 0,
            status: 'running'
        };
        
        this.activeScripts.set(deviceId, state);
        
        try {
            for (let i = 0; i < script.steps.length; i++) {
                state.currentStep = i;
                const step = script.steps[i];
                
                await this.executeStep(step, deviceId, script);
            }
            
            state.status = 'completed';
            return { success: true, steps: script.steps.length };
            
        } catch (error) {
            state.status = 'failed';
            state.error = error.message;
            return { success: false, error: error.message };
            
        } finally {
            this.activeScripts.delete(deviceId);
        }
    }
    
    // 执行单个步骤
    async executeStep(step, deviceId, script) {
        switch (step.type) {
            case 'click':
                await this.executeClick(step, deviceId);
                break;
                
            case 'wait':
                await this.executeWait(step);
                break;
                
            case 'condition':
                await this.executeCondition(step, deviceId, script);
                break;
                
            case 'loop':
                await this.executeLoop(step, deviceId, script);
                break;
                
            case 'switch_window':
                await this.executeSwitchWindow(step, deviceId);
                break;
                
            case 'input':
                await this.executeInput(step, deviceId);
                break;
        }
        
        // 处理延迟
        if (step.delay) {
            await this.executeWait({ ms: step.delay });
        }
    }
    
    // 执行点击
    async executeClick(step, deviceId) {
        const ws = this.getDeviceWs(deviceId);
        if (!ws) {
            throw new Error(`Device not connected: ${deviceId}`);
        }
        
        // 获取偏移量
        const offset = this.getDeviceOffset(deviceId, script);
        
        // 计算真实坐标
        const realX = step.x - offset.offset_x;
        const realY = step.y - offset.offset_y;
        
        // 发送点击指令
        ws.send(JSON.stringify({
            type: 'script_click',
            x: realX,
            y: realY,
            window_id: step.window_id
        }));
    }
    
    // 执行条件判断
    async executeCondition(step, deviceId, script) {
        // 请求设备截图
        const screenshot = await this.requestScreenshot(deviceId);
        
        // 解码截图
        const img = this.decodeBase64Image(step.image);
        
        // 计算相似度
        const similarity = this.calculateSimilarity(screenshot, img);
        
        // 判断是否匹配
        const matched = similarity > 0.8;
        
        // 执行对应分支
        const branch = matched ? step.then : step.else;
        if (branch) {
            for (const subStep of branch) {
                await this.executeStep(subStep, deviceId, script);
            }
        }
    }
    
    // 计算图片相似度
    calculateSimilarity(img1, img2) {
        // 使用直方图比较或特征匹配
        const hist1 = this.calculateHistogram(img1);
        const hist2 = this.calculateHistogram(img2);
        
        return this.compareHistograms(hist1, hist2);
    }
}
```

---

## 九、截图取样功能

### 9.1 取样流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  截图取样流程                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. 用户点击"取样截图"按钮                                                   │
│                                                                              │
│  2. Server请求设备当前截图                                                    │
│     ws.send(JSON.stringify({type: 'request_screenshot'}))                  │
│                                                                              │
│  3. 客户端返回截图（Base64格式）                                              │
│     {type: 'screenshot', image: 'data:image/png;base64,...'}                │
│                                                                              │
│  4. Web端显示截图，用户框选区域                                               │
│     - 用户拖动鼠标框选                                                        │
│     - 记录: x, y, width, height                                             │
│                                                                              │
│  5. Server裁剪选区，保存为条件图片                                            │
│     croppedImage = originalImage.crop(x, y, width, height)                   │
│                                                                              │
│  6. 保存到脚本JSON                                                           │
│     {                                                                         │
│       type: 'image_sample',                                                  │
│       x: 100, y: 200, width: 50, height: 50,                                │
│       image: 'data:image/png;base64,...'                                     │
│     }                                                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 取样模块

```javascript
// Web端截图取样
class ImageSampler {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.isSelecting = false;
        this.startX = 0;
        this.startY = 0;
        this.selectionRect = null;
    }
    
    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // 绑定事件
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    }
    
    loadImage(base64) {
        const img = new Image();
        img.onload = () => {
            this.canvas.width = img.width;
            this.canvas.height = img.height;
            this.ctx.drawImage(img, 0, 0);
            this.sourceImage = img;
        };
        img.src = base64;
    }
    
    onMouseDown(e) {
        this.isSelecting = true;
        this.startX = e.offsetX;
        this.startY = e.offsetY;
    }
    
    onMouseMove(e) {
        if (!this.isSelecting) return;
        
        const currentX = e.offsetX;
        const currentY = e.offsetY;
        
        // 重绘
        this.ctx.drawImage(this.sourceImage, 0, 0);
        
        // 绘制选择框
        this.ctx.strokeStyle = '#00FF00';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(
            this.startX,
            this.startY,
            currentX - this.startX,
            currentY - this.startY
        );
        
        // 填充半透明
        this.ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
        this.ctx.fillRect(
            this.startX,
            this.startY,
            currentX - this.startX,
            currentY - this.startY
        );
        
        // 显示尺寸
        const width = Math.abs(currentX - this.startX);
        const height = Math.abs(currentY - this.startY);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillText(`${width} x ${height}`, currentX + 5, currentY + 15);
    }
    
    onMouseUp(e) {
        if (!this.isSelecting) return;
        this.isSelecting = false;
        
        const endX = e.offsetX;
        const endY = e.offsetY;
        
        this.selectionRect = {
            x: Math.min(this.startX, endX),
            y: Math.min(this.startY, endY),
            width: Math.abs(endX - this.startX),
            height: Math.abs(endY - this.startY)
        };
    }
    
    cropSelection() {
        if (!this.selectionRect || !this.sourceImage) {
            throw new Error('No selection or image');
        }
        
        const { x, y, width, height } = this.selectionRect;
        
        // 创建临时canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 裁剪
        tempCtx.drawImage(
            this.sourceImage,
            x, y, width, height,
            0, 0, width, height
        );
        
        // 转为Base64
        return tempCanvas.toDataURL('image/png');
    }
    
    getSampleData() {
        if (!this.selectionRect) {
            throw new Error('No selection');
        }
        
        return {
            type: 'image_sample',
            ...this.selectionRect,
            image: this.cropSelection(),
            timestamp: Date.now()
        };
    }
}
```

---

## 十、Python代码生成

### 10.1 脚本执行引擎

```python
# client/script_engine.py
class ScriptEngine:
    """脚本执行引擎"""
    
    def __init__(self, device_id, ws, offset=(0, 0), memory_injector=None):
        self.device_id = device_id
        self.ws = ws
        self.offset = offset
        self.memory_injector = memory_injector
        self.running = False
        self.steps = []
        self.current_step = 0
    
    def load_script(self, script_data):
        """加载脚本"""
        self.steps = script_data.get('steps', [])
        self.offset = (
            script_data.get('offset', {}).get('offset_x', 0),
            script_data.get('offset', {}).get('offset_y', 0)
        )
        print(f"[引擎] 加载脚本，共 {len(self.steps)} 步")
    
    async def execute(self):
        """执行脚本"""
        self.running = True
        self.current_step = 0
        
        try:
            for i, step in enumerate(self.steps):
                if not self.running:
                    break
                
                self.current_step = i
                await self.execute_step(step)
                
        except Exception as e:
            print(f"[引擎] 执行出错: {e}")
            raise
            
        finally:
            self.running = False
            print("[引擎] 脚本执行完成")
    
    async def execute_step(self, step):
        """执行单个步骤"""
        step_type = step['type']
        
        if step_type == 'click':
            await self.execute_click(step)
        elif step_type == 'wait':
            self.execute_wait(step)
        elif step_type == 'condition':
            await self.execute_condition(step)
        elif step_type == 'loop':
            await self.execute_loop(step)
        elif step_type == 'switch_window':
            await self.execute_switch_window(step)
        elif step_type == 'input':
            await self.execute_input(step)
        elif step_type == 'image_sample':
            self.save_image_sample(step)
        
        # 处理延迟
        delay = step.get('delay', 100) / 1000
        if delay > 0:
            await asyncio.sleep(delay)
    
    async def execute_click(self, step):
        """执行点击"""
        x = step['x']
        y = step['y']
        window_id = step.get('window_id')
        
        # 应用偏移量
        real_x = x - self.offset[0]
        real_y = y - self.offset[1]
        
        if self.memory_injector and self.memory_injector.connected:
            # 内存注入方式
            self.memory_injector.click_at(real_x, real_y)
        else:
            # 普通方式
            await self.mouse_click(real_x, real_y, window_id)
        
        comment = step.get('comment', '')
        print(f"[步骤] 点击 ({x}, {y}) → 实际 ({real_x}, {real_y}) {comment}")
    
    async def mouse_click(self, x, y, window_id=None):
        """鼠标点击"""
        if window_id:
            # 切换窗口
            self.switch_to_window(window_id)
        
        # 移动鼠标
        win32api.SetCursorPos((int(x), int(y)))
        await asyncio.sleep(0.01)
        
        # 点击
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        await asyncio.sleep(0.05)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    
    def execute_wait(self, step):
        """执行等待"""
        ms = step.get('ms', 0)
        print(f"[步骤] 等待 {ms}ms")
        time.sleep(ms / 1000)
    
    async def execute_condition(self, step):
        """执行条件判断"""
        condition = step.get('condition')
        timeout = step.get('timeout', 5000)
        then_steps = step.get('then', [])
        else_steps = step.get('else', [])
        
        print(f"[步骤] 条件判断: {condition}")
        
        # 请求截图
        screenshot = await self.request_screenshot()
        
        # 判定
        matched = self.check_condition(screenshot, step)
        
        # 执行分支
        if matched:
            print(f"[条件] 匹配，执行then分支 ({len(then_steps)}步)")
            for sub_step in then_steps:
                await self.execute_step(sub_step)
        else:
            print(f"[条件] 不匹配，执行else分支 ({len(else_steps)}步)")
            for sub_step in else_steps:
                await self.execute_step(sub_step)
    
    async def execute_loop(self, step):
        """执行循环"""
        times = step.get('times', 1)
        loop_steps = step.get('steps', [])
        
        print(f"[步骤] 循环执行 {times} 次")
        
        for i in range(times):
            print(f"[循环] 第 {i+1}/{times} 次")
            for sub_step in loop_steps:
                await self.execute_step(sub_step)
    
    async def execute_switch_window(self, step):
        """切换窗口"""
        target_window_id = step.get('target_window_id')
        print(f"[步骤] 切换到窗口 {target_window_id}")
        self.switch_to_window(target_window_id)
    
    async def execute_input(self, step):
        """输入文本"""
        text = step.get('text', '')
        print(f"[步骤] 输入: {text}")
        
        # 发送文本输入
        for char in text:
            win32api.keybd_event(ord(char), 0, 0, 0)
            await asyncio.sleep(0.01)
            win32api.keybd_event(ord(char), 0, win32con.KEYEVENTF_KEYUP, 0)
    
    def switch_to_window(self, window_id):
        """切换窗口"""
        hwnd = self.windows.get(window_id)
        if hwnd:
            win32gui.SetForegroundWindow(hwnd)
            time.sleep(0.1)
    
    async def request_screenshot(self):
        """请求截图"""
        # 实现截图请求逻辑
        pass
    
    def check_condition(self, screenshot, step):
        """检查条件是否满足"""
        condition = step.get('condition')
        
        if condition == 'image_exists':
            template = step.get('image')
            return self.template_match(screenshot, template)
        
        return False
    
    def template_match(self, screenshot, template):
        """模板匹配"""
        # 使用OpenCV进行模板匹配
        # 返回相似度
        pass
    
    def save_image_sample(self, step):
        """保存取样图片"""
        image_data = step.get('image')
        name = step.get('name', 'sample')
        # 保存到本地
        pass
    
    def stop(self):
        """停止执行"""
        self.running = False
        print("[引擎] 停止执行")
```

### 10.2 Python代码预览生成

```javascript
// Web端Python代码预览生成
function generatePythonCode(scriptData) {
    let code = `# 自动生成的脚本\n`;
    code += `# 脚本名称: ${scriptData.name}\n`;
    code += `# 版本: ${scriptData.version}\n\n`;
    
    code += `from script_engine import ScriptEngine\n\n`;
    code += `async def run_script(ws, memory_injector=None):\n`;
    code += `    engine = ScriptEngine(device_id='${scriptData.deviceId}', ws=ws)\n`;
    code += `    engine.load_script({\n`;
    code += `        'offset': ${JSON.stringify(scriptData.offset)},\n`;
    code += `        'windows': ${JSON.stringify(scriptData.windows)},\n`;
    code += `        'steps': [\n`;
    
    scriptData.steps.forEach((step, index) => {
        code += `            ${generateStepCode(step, index)}`;
        if (index < scriptData.steps.length - 1) {
            code += `,\n`;
        } else {
            code += `\n`;
        }
    });
    
    code += `        ]\n`;
    code += `    })\n`;
    code += `    await engine.execute()\n\n`;
    
    code += `if __name__ == '__main__':\n`;
    code += `    import asyncio\n`;
    code += `    asyncio.run(run_script())\n`;
    
    return code;
}

function generateStepCode(step, index) {
    let code = '';
    const indent = '            ';
    
    switch (step.type) {
        case 'click':
            code += `{\n${indent}    'type': 'click',\n${indent}    'x': ${step.x},\n${indent}    'y': ${step.y}`;
            if (step.window_id) {
                code += `,\n${indent}    'window_id': ${step.window_id}`;
            }
            if (step.comment) {
                code += `,\n${indent}    'comment': '${step.comment}'`;
            }
            code += `\n${indent}}`;
            break;
            
        case 'wait':
            code += `{\n${indent}    'type': 'wait',\n${indent}    'ms': ${step.ms}\n${indent}}`;
            break;
            
        case 'condition':
            code += `{\n${indent}    'type': 'condition',\n${indent}    'condition': '${step.condition}'`;
            code += `,\n${indent}    'image': '...',\n${indent}    'timeout': ${step.timeout}`;
            code += `\n${indent}}`;
            break;
            
        case 'loop':
            code += `{\n${indent}    'type': 'loop',\n${indent}    'times': ${step.times}`;
            code += `,\n${indent}    'steps': [...]`;
            code += `\n${indent}}`;
            break;
            
        case 'input':
            code += `{\n${indent}    'type': 'input',\n${indent}    'text': '${step.text}'\n${indent}}`;
            break;
            
        case 'switch_window':
            code += `{\n${indent}    'type': 'switch_window',\n${indent}    'target_window_id': ${step.target_window_id}\n${indent}}`;
            break;
            
        default:
            code += `{\n${indent}    'type': '${step.type}'\n${indent}}`;
    }
    
    return code;
}
```

---

## 十一、总结

### 11.1 功能优先级

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 基础脚本编辑 | P0 | 点击/等待/输入/循环 |
| 脚本录制 | P0 | 自动记录用户操作 |
| 偏移量计算 | P0 | 客户端本地计算 |
| 多窗口支持 | P0 | 每个窗口独立配置 |
| 截图取样 | P1 | 条件判断的核心 |
| 条件判断 | P1 | 图片存在判断 |
| 内存注入 | P2 | 高级功能，按需开发 |
| Python代码生成 | P2 | 高级用户使用 |

### 11.2 开发计划

```
第1周：
├─ 基础界面设计
├─ 脚本JSON格式定义
├─ 基础组件实现（点击/等待/输入）
└─ 简单脚本执行

第2周：
├─ 脚本录制功能
├─ 偏移量计算模块
├─ 多窗口支持
└─ 截图取样功能

第3周：
├─ 条件判断逻辑
├─ Server端判定引擎
└─ 完整执行流程

第4周（可选）：
├─ 内存注入模块
├─ Python代码生成
└─ 高级功能优化
```

### 11.3 技术要点

1. **偏移量计算**：客户端本地截图 + 鼠标指针识别
2. **内存注入**：使用Cheat Engine逆向分析游戏内存地址
3. **多窗口**：每个窗口独立配置 + 窗口切换
4. **条件判断**：Server端截图对比 + 相似度计算
5. **脚本格式**：JSON简单易扩展 + Python代码预览

---

*文档创建日期：2026-06-07*
*最后更新：2026-06-07*
