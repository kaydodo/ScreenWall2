import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import hashlib
import os
import threading

class MD5Tool:
    def __init__(self, root):
        self.root = root
        self.root.title("MD5 文件校验工具")
        self.root.geometry("550x450")
        self.root.resizable(False, False)
        
        self.file_path = ""
        self.md5_value = ""
        self.is_calculating = False
        
        self.create_ui()
    
    def create_ui(self):
        # 文件选择区域
        file_frame = tk.LabelFrame(self.root, text="文件选择", padx=10, pady=10)
        file_frame.pack(fill="x", padx=10, pady=10)
        
        self.file_label = tk.Label(file_frame, text="未选择文件", width=45, anchor="w", fg="gray")
        self.file_label.pack(side="left", padx=5)
        
        select_btn = tk.Button(file_frame, text="选择文件", command=self.select_file, width=10)
        select_btn.pack(side="right", padx=5)
        
        # 文件大小显示
        self.size_label = tk.Label(self.root, text="文件大小: ", fg="gray")
        self.size_label.pack(anchor="w", padx=15)
        
        # 进度条
        self.progress_frame = tk.Frame(self.root)
        self.progress_frame.pack(fill="x", padx=10, pady=5)
        
        self.progress_bar = ttk.Progressbar(self.progress_frame, length=500, mode="determinate")
        self.progress_bar.pack(fill="x", padx=5)
        
        self.progress_label = tk.Label(self.progress_frame, text="", fg="blue")
        self.progress_label.pack()
        
        # MD5生成区域
        gen_frame = tk.LabelFrame(self.root, text="生成MD5", padx=10, pady=10)
        gen_frame.pack(fill="x", padx=10, pady=5)
        
        self.gen_md5_label = tk.Label(gen_frame, text="MD5: ", width=50, anchor="w", wraplength=400)
        self.gen_md5_label.pack(fill="x", padx=5, pady=5)
        
        btn_frame = tk.Frame(gen_frame)
        btn_frame.pack(fill="x", pady=5)
        
        gen_btn = tk.Button(btn_frame, text="生成MD5", command=self.start_generate, width=12)
        gen_btn.pack(side="left", padx=10)
        
        copy_btn = tk.Button(btn_frame, text="复制MD5", command=self.copy_md5, width=12)
        copy_btn.pack(side="left", padx=10)
        
        # MD5验证区域
        verify_frame = tk.LabelFrame(self.root, text="验证MD5", padx=10, pady=10)
        verify_frame.pack(fill="x", padx=10, pady=5)
        
        tk.Label(verify_frame, text="输入预期的MD5值:").pack(anchor="w", padx=5)
        
        self.verify_input = tk.Entry(verify_frame, width=60)
        self.verify_input.pack(fill="x", padx=5, pady=5)
        
        verify_btn = tk.Button(verify_frame, text="验证MD5", command=self.start_verify, width=12)
        verify_btn.pack(pady=5)
        
        # 结果显示
        self.result_label = tk.Label(self.root, text="", fg="blue", font=("Arial", 12, "bold"))
        self.result_label.pack(pady=10)
    
    def select_file(self):
        file_path = filedialog.askopenfilename(title="选择文件")
        if file_path:
            self.file_path = file_path
            filename = os.path.basename(file_path)
            if len(filename) > 40:
                filename = filename[:37] + "..."
            self.file_label.config(text=filename, fg="black")
            
            # 显示文件大小
            file_size = os.path.getsize(file_path)
            size_str = self.format_size(file_size)
            self.size_label.config(text=f"文件大小: {size_str}", fg="black")
            
            self.gen_md5_label.config(text="MD5: ")
            self.result_label.config(text="")
            self.progress_bar['value'] = 0
            self.progress_label.config(text="")
    
    def format_size(self, size):
        if size < 1024:
            return f"{size} B"
        elif size < 1024 * 1024:
            return f"{size / 1024:.2f} KB"
        elif size < 1024 * 1024 * 1024:
            return f"{size / (1024 * 1024):.2f} MB"
        else:
            return f"{size / (1024 * 1024 * 1024):.2f} GB"
    
    def start_generate(self):
        if not self.file_path:
            messagebox.showwarning("提示", "请先选择文件")
            return
        
        if self.is_calculating:
            messagebox.showwarning("提示", "正在计算中...")
            return
        
        self.is_calculating = True
        self.progress_bar['value'] = 0
        self.progress_label.config(text="正在计算MD5...", fg="blue")
        self.result_label.config(text="")
        
        thread = threading.Thread(target=self.generate_md5_thread)
        thread.start()
    
    def generate_md5_thread(self):
        try:
            file_size = os.path.getsize(self.file_path)
            md5_hash = hashlib.md5()
            processed = 0
            chunk_size = 8192
            
            with open(self.file_path, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    md5_hash.update(chunk)
                    processed += len(chunk)
                    
                    # 更新进度
                    progress = (processed / file_size) * 100
                    self.root.after(0, lambda p=progress: self.update_progress(p))
            
            self.md5_value = md5_hash.hexdigest()
            self.root.after(0, self.finish_generate)
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("错误", f"生成MD5失败: {str(e)}"))
            self.root.after(0, self.reset_calculating)
    
    def update_progress(self, progress):
        self.progress_bar['value'] = progress
        self.progress_label.config(text=f"计算进度: {progress:.1f}%")
    
    def finish_generate(self):
        self.gen_md5_label.config(text=f"MD5: {self.md5_value}")
        self.verify_input.delete(0, tk.END)
        self.verify_input.insert(0, self.md5_value)
        self.progress_label.config(text="计算完成!", fg="green")
        self.is_calculating = False
    
    def reset_calculating(self):
        self.progress_bar['value'] = 0
        self.progress_label.config(text="")
        self.is_calculating = False
    
    def copy_md5(self):
        if self.md5_value:
            self.root.clipboard_clear()
            self.root.clipboard_append(self.md5_value)
            messagebox.showinfo("提示", "MD5已复制到剪贴板")
        else:
            messagebox.showwarning("提示", "请先生成MD5")
    
    def start_verify(self):
        if not self.file_path:
            messagebox.showwarning("提示", "请先选择文件")
            return
        
        if self.is_calculating:
            messagebox.showwarning("提示", "正在计算中...")
            return
        
        input_md5 = self.verify_input.get().strip().lower()
        if not input_md5:
            messagebox.showwarning("提示", "请输入要验证的MD5值")
            return
        
        self.is_calculating = True
        self.progress_bar['value'] = 0
        self.progress_label.config(text="正在验证MD5...", fg="blue")
        
        thread = threading.Thread(target=self.verify_md5_thread, args=(input_md5,))
        thread.start()
    
    def verify_md5_thread(self, input_md5):
        try:
            file_size = os.path.getsize(self.file_path)
            md5_hash = hashlib.md5()
            processed = 0
            chunk_size = 8192
            
            with open(self.file_path, "rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    md5_hash.update(chunk)
                    processed += len(chunk)
                    
                    progress = (processed / file_size) * 100
                    self.root.after(0, lambda p=progress: self.update_progress(p))
            
            actual_md5 = md5_hash.hexdigest()
            
            if input_md5 == actual_md5:
                self.root.after(0, lambda: self.show_result(True, actual_md5, input_md5))
            else:
                self.root.after(0, lambda: self.show_result(False, actual_md5, input_md5))
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("错误", f"验证失败: {str(e)}"))
            self.root.after(0, self.reset_calculating)
    
    def show_result(self, success, actual_md5, input_md5):
        self.is_calculating = False
        if success:
            self.progress_label.config(text="验证完成!", fg="green")
            self.result_label.config(text="✓ 验证成功！MD5匹配", fg="green")
            messagebox.showinfo("验证结果", "验证成功！\n文件MD5与输入值匹配")
        else:
            self.progress_label.config(text="验证完成!", fg="red")
            self.result_label.config(text="✗ 验证失败！MD5不匹配", fg="red")
            messagebox.showerror("验证结果", f"验证失败！\n文件实际MD5: {actual_md5}\n输入的MD5: {input_md5}")

if __name__ == "__main__":
    root = tk.Tk()
    app = MD5Tool(root)
    root.mainloop()