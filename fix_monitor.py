import re

p = 'D:/ScreenWall2/server/public/monitor-wall.html'
with open(p, 'r', encoding='utf-8') as f:
    c = f.read()

# 删除 wallScreenshot 和 wallScreenshotBatch 两个 if 块
# 从 "      if (data.type === 'wallScreenshot') {" 开始
# 到 "      if (data.type === 'wallStateUpdate') {" 之前
pattern = r'(\s*)if \(data\.type === \'wallScreenshot\'\) \{.*?\}\s*if \(data\.type === \'wallScreenshotBatch.*?\{.*?\}\s*'
replacement = r'\1// 二进制0x12帧已负责动态画面，跳过JSON静态图路径\n\1if (data.type === \'wallScreenshot\' || data.type === \'wallScreenshotBatch\') return;\n\n'
new_c = re.sub(pattern, replacement, c, flags=re.DOTALL)
if new_c == c:
    print('未找到匹配')
else:
    with open(p, 'w', encoding='utf-8') as f:
        f.write(new_c)
    print('修复完成')
