param([Parameter(Mandatory=$true)][int]$OwnerPid,[Parameter(Mandatory=$true)][string]$WindowHandles,[ValidateSet('0','1')][string]$Topmost='1',[switch]$Once)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Text;
using System.Runtime.InteropServices;
namespace GptNiangDesktop {
 [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Services { void QueryService(ref Guid service, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object result); }
 [ComImport, Guid("1841C6D7-4F9D-42C0-AF41-8747538F10E5"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Views {
  void GetViews(out IntPtr views); void GetViewsByZOrder(out IntPtr views); void GetViewsByAppUserModelId([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr views);
  [PreserveSig] int GetViewForHwnd(IntPtr hwnd, out IntPtr view);
 }
 [ComImport, Guid("4CE81583-1E4C-4632-A621-07A53543148F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Pins {
  [return:MarshalAs(UnmanagedType.Bool)] bool IsAppIdPinned([MarshalAs(UnmanagedType.LPWStr)] string id);
  void PinAppID([MarshalAs(UnmanagedType.LPWStr)] string id); void UnpinAppID([MarshalAs(UnmanagedType.LPWStr)] string id);
  [return:MarshalAs(UnmanagedType.Bool)] bool IsViewPinned(IntPtr view);
  void PinView(IntPtr view); void UnpinView(IntPtr view);
 }
 public static class WindowPin {
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd,int index);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int cx,int cy,uint flags);
  [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  delegate bool EnumWindowProc(IntPtr hwnd,IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowProc callback,IntPtr data);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder value,int count);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out int value,int size);
  public static string YieldingTo {get;private set;}
  public static bool IsSystemPopupClass(string name,string process){
   string c=(name??"").ToLowerInvariant(),p=(process??"").ToLowerInvariant();
   // Match transient surfaces, never Explorer's ordinary folder windows or
   // Chromium application windows. No titles, typed text or candidate text
   // are read. Visible, uncloaked and intersecting bounds are checked below.
   if(c=="notifyiconoverflowwindow" || c=="toplevelwindowforoverflowxamlisland" || c=="#32768")return true;
   if(c=="microsoft.ime.candidatewindow.host" || c=="msctfime ui" || c=="ciceroui wndframe" || c=="cicerouiwndframe" || c=="ime")return true;
   if(c.Contains("candidate") || c.Contains("sogou") || c.Contains("pinyin") || c.StartsWith("bdime"))return true;
   bool input=p=="textinputhost" || p=="inputapp" || p=="chsime" || p=="chtime" || p=="ctfmon";
   if(input && (c.Contains("corewindow") || c.Contains("desktopwindowcontentbridge") || c.Contains("popupwindowsitebridge")))return true;
   bool shell=p=="explorer" || p=="shellexperiencehost";
   return shell && (c=="xaml_windowedpopupclass" || c.Contains("popupwindowsitebridge"));
  }
  static bool Intersects(Rect a,Rect b){return a.Left<b.Right && a.Right>b.Left && a.Top<b.Bottom && a.Bottom>b.Top;}
  static IntPtr FindSystemPopup(long[] handles,int owner){
   IntPtr found=IntPtr.Zero;string foundClass="";
   EnumWindows(delegate(IntPtr hwnd,IntPtr data){
    uint pid;GetWindowThreadProcessId(hwnd,out pid);Rect rect;int cloaked;
    if(pid==(uint)owner || !IsWindowVisible(hwnd) || !GetWindowRect(hwnd,out rect) || rect.Right-rect.Left<3 || rect.Bottom-rect.Top<3)return true;
    if(DwmGetWindowAttribute(hwnd,14,out cloaked,4)==0 && cloaked!=0)return true;
    bool overlaps=false;foreach(long handle in handles){IntPtr pet=new IntPtr(handle);Rect bounds;uint petPid;GetWindowThreadProcessId(pet,out petPid);if(petPid==(uint)owner && IsWindowVisible(pet) && GetWindowRect(pet,out bounds) && Intersects(rect,bounds)){overlaps=true;break;}}
    if(!overlaps)return true;
    var text=new StringBuilder(256);GetClassName(hwnd,text,text.Capacity);string name=text.ToString(),process="";
    // Process lookup is needed only for generic Microsoft XAML hosts.
    if(!IsSystemPopupClass(name,""))try{using(var proc=Process.GetProcessById((int)pid)){process=proc.ProcessName;}}catch{ return true; }
    if(IsSystemPopupClass(name,process)){found=hwnd;foundClass=name;}
    return true;
   },IntPtr.Zero);
   YieldingTo=foundClass;return found;
  }
  public static bool MaintainTopmost(long[] handles,int owner){
   uint foregroundOwner;GetWindowThreadProcessId(GetForegroundWindow(),out foregroundOwner);
   // Do not reorder our own open menus or interactive dialogs.
   if(handles.Length==0)return false;
   IntPtr main=new IntPtr(handles[0]);if(!IsWindowVisible(main))return false;
   IntPtr systemPopup=FindSystemPopup(handles,owner);
   if(systemPopup!=IntPtr.Zero){
    // Demote only our own windows. This also works for candidate surfaces
    // outside the TOPMOST band. Never activate or reorder the system popup.
    bool popupTopmost=(GetWindowLongPtr(systemPopup,-20).ToInt64() & 8)!=0;
    foreach(long handle in handles){IntPtr hwnd=new IntPtr(handle);uint pid;GetWindowThreadProcessId(hwnd,out pid);
     if(pid!=(uint)owner || !IsWindowVisible(hwnd))continue;
     if((GetWindowLongPtr(hwnd,-20).ToInt64() & 8)!=0)SetWindowPos(hwnd,new IntPtr(-2),0,0,0,0,0x0013|0x0200);
     if(!popupTopmost){
      // Reorder only when a window of ours is still above the normal popup.
      for(IntPtr previous=GetWindow(systemPopup,3);previous!=IntPtr.Zero;previous=GetWindow(previous,3))if(previous==hwnd){SetWindowPos(hwnd,systemPopup,0,0,0,0,0x0013|0x0200);break;}
     }
    }
    return false;
   }
   bool covered=false;
   // Pinning or showing an owned tool window can clear WS_EX_TOPMOST. Repair
   // the actual style too, even when no competing window overlaps the pet.
   foreach(long handle in handles){IntPtr hwnd=new IntPtr(handle);if(IsWindowVisible(hwnd) && (GetWindowLongPtr(hwnd,-20).ToInt64() & 8)==0)covered=true;}
   if(foregroundOwner==(uint)owner && !covered)return false;
   IntPtr above=GetWindow(main,3);Rect pet;GetWindowRect(main,out pet);
   for(int n=0;n<512 && above!=IntPtr.Zero;n++,above=GetWindow(above,3)){
    uint other;GetWindowThreadProcessId(above,out other);
    Rect rect;GetWindowRect(above,out rect);
    if(other!=(uint)owner && IsWindowVisible(above) && (GetWindowLongPtr(above,-20).ToInt64() & 8)!=0 && rect.Left<pet.Right && rect.Right>pet.Left && rect.Top<pet.Bottom && rect.Bottom>pet.Top){covered=true;break;}
   }
   if(!covered)return false;
   foreach(long handle in handles){IntPtr hwnd=new IntPtr(handle);uint pid;GetWindowThreadProcessId(hwnd,out pid);
    if(pid==(uint)owner && IsWindowVisible(hwnd))SetWindowPos(hwnd,new IntPtr(-1),0,0,0,0,0x0013|0x0200);
   }
   return true;
  }
  public static bool Ensure(long handle, int owner) {
   IntPtr hwnd=new IntPtr(handle); uint pid; GetWindowThreadProcessId(hwnd,out pid);
   if(pid!=(uint)owner)throw new InvalidOperationException("Window does not belong to this GPT Niang process");
   // Shell manages owned tool windows with their top-level owner. The panel
   // and notice are deliberately owned by the pet and have no separate view.
   for(int n=0;n<16;n++){
    IntPtr root=GetWindow(hwnd,4);uint rootPid;GetWindowThreadProcessId(root,out rootPid);
    if(root==IntPtr.Zero || rootPid!=(uint)owner)break;hwnd=root;
   }
   object shell=null, views=null, pins=null; IntPtr view=IntPtr.Zero;
   try {
    shell=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C2F03A33-21F5-47FA-B4BB-156362A2F239")));
    var services=(Services)shell;
    Guid viewId=typeof(Views).GUID; services.QueryService(ref viewId,ref viewId,out views);
    Guid pinService=new Guid("B5A399E7-1C87-46B8-88E9-FC5747B171BD"),pinId=typeof(Pins).GUID;
    services.QueryService(ref pinService,ref pinId,out pins);
    Marshal.ThrowExceptionForHR(((Views)views).GetViewForHwnd(hwnd,out view));
    if(view==IntPtr.Zero)throw new InvalidOperationException("Window view is not ready");
    var manager=(Pins)pins; if(!manager.IsViewPinned(view))manager.PinView(view);
    return manager.IsViewPinned(view);
   } finally {
    if(view!=IntPtr.Zero)Marshal.Release(view);
    if(pins!=null)Marshal.ReleaseComObject(pins); if(views!=null)Marshal.ReleaseComObject(views); if(shell!=null)Marshal.ReleaseComObject(shell);
   }
  }
 }
}
'@
$handles=@($WindowHandles.Split(',') | ForEach-Object { [long]::Parse($_) })
$previous=''
$tick=0;$raises=0
do {
 if(-not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)){break}
 if($Topmost -eq '1' -and [GptNiangDesktop.WindowPin]::MaintainTopmost([long[]]$handles,$OwnerPid)){$raises++}
 if($tick % 15 -eq 0){
 $items=@(foreach($handle in $handles){
  try { @{handle=$handle.ToString();pinned=[GptNiangDesktop.WindowPin]::Ensure($handle,$OwnerPid)} }
  catch { @{handle=$handle.ToString();pinned=$false;error=$_.Exception.GetBaseException().Message} }
 })
 }
 $result=@{method='windows-shell-window-pin';windows=$items;allPinned=(@($items | Where-Object {-not $_.pinned}).Count -eq 0);topmostMaintenance=($Topmost -eq '1');topmostRestores=$raises;yieldingToSystemPopup=([bool][GptNiangDesktop.WindowPin]::YieldingTo);systemPopupClass=[GptNiangDesktop.WindowPin]::YieldingTo;topmostPolicy='system-popups-first-v0410'}
 $line=$result | ConvertTo-Json -Depth 4 -Compress
 if($line -ne $previous){[Console]::Out.WriteLine($line);[Console]::Out.Flush();$previous=$line}
 $tick++
 if(-not $Once){Start-Sleep -Milliseconds 200}
}while(-not $Once)
