using System;
using System.Runtime.InteropServices;

class Program
{
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern bool EnumDisplaySettings(string deviceName, int modeNum, [In, Out] DEVMODE devMode);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern int ChangeDisplaySettings([In] DEVMODE devMode, int flags);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    class DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName = "";
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
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
        public string dmFormName = "";
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

    const int ENUM_CURRENT_SETTINGS = -1;
    const int CDS_UPDATEREGISTRY = 0x01;
    const int CDS_RESET = 0x40000000;
    const int DISP_CHANGE_SUCCESSFUL = 0;

    static void Main()
    {
        Console.WriteLine("==================================================");
        Console.WriteLine("  Simple Display Settings Tool");
        Console.WriteLine("==================================================");
        Console.WriteLine("  Target: 1920x1080 @ 60Hz");
        Console.WriteLine("==================================================");
        Console.WriteLine();

        DEVMODE current = new DEVMODE();
        if (EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, current))
        {
            Console.WriteLine("Current: {0}x{1} @ {2}Hz", current.dmPelsWidth, current.dmPelsHeight, current.dmDisplayFrequency);
            Console.WriteLine();

            if (current.dmPelsWidth == 1920 && current.dmPelsHeight == 1080 && current.dmDisplayFrequency == 60)
            {
                Console.WriteLine("Already at target resolution!");
                Console.WriteLine();
                Console.Write("Press any key to exit...");
                Console.ReadKey();
                return;
            }
        }

        Console.WriteLine("Looking for 1920x1080 @ 60Hz...");
        Console.WriteLine();

        DEVMODE target = null;
        int modeNum = 0;
        while (true)
        {
            DEVMODE dm = new DEVMODE();
            if (!EnumDisplaySettings(null, modeNum++, dm))
                break;

            if (dm.dmPelsWidth == 1920 && dm.dmPelsHeight == 1080 && dm.dmDisplayFrequency == 60)
            {
                Console.WriteLine("FOUND! Mode found at index {0}", modeNum - 1);
                Console.WriteLine("  Bits: {0}, Flags: {1}", dm.dmBitsPerPel, dm.dmDisplayFlags);
                target = dm;
                break;
            }
        }

        if (target == null)
        {
            Console.WriteLine("ERROR: Mode 1920x1080 @ 60Hz not found!");
            Console.WriteLine();
            Console.WriteLine("Available modes:");
            modeNum = 0;
            while (true)
            {
                DEVMODE dm = new DEVMODE();
                if (!EnumDisplaySettings(null, modeNum++, dm))
                    break;
                Console.WriteLine("  {0}x{1} @ {2}Hz", dm.dmPelsWidth, dm.dmPelsHeight, dm.dmDisplayFrequency);
            }
            Console.WriteLine();
            Console.Write("Press any key to exit...");
            Console.ReadKey();
            return;
        }

        Console.WriteLine();
        Console.Write("Applying changes... ");

        int result = ChangeDisplaySettings(target, CDS_UPDATEREGISTRY | CDS_RESET);

        if (result == DISP_CHANGE_SUCCESSFUL)
        {
            Console.WriteLine("SUCCESS!");
            Console.WriteLine();
            Console.WriteLine("Display changed to 1920x1080 @ 60Hz!");
        }
        else
        {
            Console.WriteLine("FAILED! Code: {0}", result);
        }

        Console.WriteLine();
        Console.Write("Press any key to exit...");
        Console.ReadKey();
    }
}
