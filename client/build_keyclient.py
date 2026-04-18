# -*- mode: python ; coding: utf-8 -*-
import PyInstaller.__main__

PyInstaller.__main__.run([
    'keyclient.py',
    '--name=KeyClient',
    '--onedir',
    '--windowed',
    '--clean',
])
