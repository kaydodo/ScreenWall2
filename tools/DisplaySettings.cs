using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;

class Program
{
    [DllImport("user32.dll")]
    static extern int ChangeDisplaySettingsEx(string deviceName, [In] ref DEVMODE dm, IntPtr hwnd, uint flags, IntPtr param);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE dm);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public short dmLogPixels;
        public short dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }

    const uint CDS_UPDATEREGISTRY = 0x01;
    const uint CDS_TEST = 0x04;
    const uint CDS_RESET = 0x40000000;
    const uint CDS_FULLSCREEN = 0x04;
    const int DISP_CHANGE_SUCCESSFUL = 0;
    const int DISP_CHANGE_RESTART = 1;
    const int DISP_CHANGE_BADMODE = -2;
    const int DISP_CHANGE_FAILED = -1;
    const int ENUM_CURRENT_SETTINGS = -1;
    const int DM_BITSPERPEL = 0x00040000;
    const int DM_PELSWIDTH = 0x00080000;
    const int DM_PELSHEIGHT = 0x00100000;
    const int DM_DISPLAYFLAGS = 0x00200000;
    const int DM_DISPLAYFREQUENCY = 0x00400000;

    static bool IsAdmin()
    {
        WindowsIdentity identity = WindowsIdentity.GetCurrent();
        WindowsPrincipal principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }

    static void Main()
    {
        Console.WriteLine("==================================================");
        Console.WriteLine("  Windows Display Settings Tool");
        Console.WriteLine("==================================================");
        Console.WriteLine("  Target: 1920x1080 @ 60Hz");
        Console.WriteLine("==================================================");
        Console.WriteLine();

        DEVMODE dm = new DEVMODE();
        dm.dmSize = (short)Marshal.SizeOf(dm);

        Console.Write("Step 1/3: Reading current settings...");
        EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref dm);
        Console.WriteLine(" OK");
        Console.WriteLine("  Current: {0}x{1} @ {2}Hz", dm.dmPelsWidth, dm.dmPelsHeight, dm.dmDisplayFrequency);
        Console.WriteLine();

        if (dm.dmPelsWidth == 1920 && dm.dmPelsHeight == 1080 && dm.dmDisplayFrequency == 60)
        {
            Console.WriteLine("Already at target resolution!");
            Console.WriteLine();
            Console.Write("Press any key to exit...");
            Console.ReadKey();
            return;
        }

        dm.dmPelsWidth = 1920;
        dm.dmPelsHeight = 1080;
        dm.dmDisplayFrequency = 60;
        dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;

        Console.Write("Step 2/3: Testing display mode...");
        int testResult = ChangeDisplaySettingsEx(null, ref dm, IntPtr.Zero, CDS_TEST, IntPtr.Zero);
        if (testResult != DISP_CHANGE_SUCCESSFUL)
        {
            Console.WriteLine(" FAILED");
            Console.WriteLine("  Test result: {0}", testResult);
            if (testResult == DISP_CHANGE_BADMODE)
                Console.WriteLine("  Error: This display mode is not supported by your graphics adapter.");
            Console.WriteLine();
            Console.Write("Press any key to exit...");
            Console.ReadKey();
            return;
        }
        Console.WriteLine(" OK");
        Console.WriteLine();

        Console.Write("Step 3/3: Applying and saving changes...");
        int applyResult = ChangeDisplaySettingsEx(null, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_RESET, IntPtr.Zero);
        if (applyResult == DISP_CHANGE_SUCCESSFUL)
        {
            Console.WriteLine(" OK");
            Console.WriteLine("  Resolution changed NOW and saved!");
        }
        else if (applyResult == DISP_CHANGE_RESTART)
        {
            Console.WriteLine(" OK (restart required)");
        }
        else
        {
            Console.WriteLine(" FAILED (code: {0})", applyResult);
            Console.WriteLine();
            Console.Write("Press any key to exit...");
            Console.ReadKey();
            return;
        }

        Console.WriteLine();
        Console.WriteLine();
        Console.WriteLine("DONE! Display is now: 1920x1080 @ 60Hz");
        Console.WriteLine();
        Console.Write("Press any key to exit...");
        Console.ReadKey();
    }
}