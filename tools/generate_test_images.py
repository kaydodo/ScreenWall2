import os
import random
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime

WIDTH = 1280
HEIGHT = 1024

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

COLORS = [
    '#1a1a2e', '#16213e', '#0f3460', '#e94560',
    '#533483', '#2c3333', '#395B64', '#A5C9CA',
    '#00587A', '#008891', '#01C5C4', '#B4D8E7',
    '#F67280', '#C06C84', '#355C7D', '#6C5B7B'
]

SHAPES = ['circle', 'rect', 'triangle', 'cross', 'star']

def random_color():
    return COLORS[random.randint(0, len(COLORS) - 1)]

def draw_shape(draw, shape, x, y, size, color):
    if shape == 'circle':
        draw.ellipse([x - size, y - size, x + size, y + size], fill=color)
    elif shape == 'rect':
        draw.rectangle([x - size, y - size, x + size, y + size], fill=color)
    elif shape == 'triangle':
        points = [(x, y - size), (x - size, y + size), (x + size, y + size)]
        draw.polygon(points, fill=color)
    elif shape == 'cross':
        draw.rectangle([x - size//4, y - size, x + size//4, y + size], fill=color)
        draw.rectangle([x - size, y - size//4, x + size, y + size//4], fill=color)
    elif shape == 'star':
        points = []
        for i in range(5):
            angle = i * 72 - 90
            px = x + size * 0.5 * (1 + 0.5 * (i % 2)) * (1 if i % 2 == 0 else 0.5) * (1 if angle >= 0 else -1)
            py = y + size * 0.5 * (1 + 0.5 * (i % 2)) * (1 if i % 2 == 0 else 0.5) * (1 if angle >= 0 else -1)
        draw.polygon([(x, y - size), (x + size*0.3, y - size*0.3), (x + size, y), 
                      (x + size*0.3, y + size*0.3), (x, y + size),
                      (x - size*0.3, y + size*0.3), (x - size, y),
                      (x - size*0.3, y - size*0.3)], fill=color)

def generate_image(label, filename):
    img = Image.new('RGB', (WIDTH, HEIGHT), '#0f0f1a')
    draw = ImageDraw.Draw(img)
    
    bg_color = random_color()
    draw.rectangle([0, 0, WIDTH, HEIGHT], fill=bg_color)
    
    for _ in range(random.randint(5, 15)):
        shape = SHAPES[random.randint(0, len(SHAPES) - 1)]
        x = random.randint(100, WIDTH - 100)
        y = random.randint(100, HEIGHT - 100)
        size = random.randint(30, 80)
        color = random_color()
        draw_shape(draw, shape, x, y, size, color)
    
    try:
        font = ImageFont.truetype('arial.ttf', 72)
    except:
        font = ImageFont.load_default()
    
    timestamp = datetime.now().strftime('%H:%M:%S')
    text = f'{label} - {timestamp}'
    
    text_bbox = draw.textbbox((0, 0), text, font=font)
    text_width = text_bbox[2] - text_bbox[0]
    text_x = (WIDTH - text_width) // 2
    text_y = 30
    
    draw.rectangle([text_x - 10, text_y - 5, text_x + text_width + 10, text_y + 80], fill='#0f0f1a')
    draw.text((text_x, text_y), text, font=font, fill='#4f8ef7')
    
    filepath = os.path.join(OUTPUT_DIR, filename)
    img.save(filepath, 'PNG')
    print(f'生成: {filename}')
    return filepath

def main():
    left_file = generate_image('左五趴', '左五趴.png')
    right_file = generate_image('右五趴', '右五趴.png')
    print(f'完成: {left_file}, {right_file}')

if __name__ == '__main__':
    main()