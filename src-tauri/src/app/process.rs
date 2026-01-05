use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND};
use windows_sys::Win32::System::Diagnostics::Debug::{
  FlushInstructionCache, ReadProcessMemory, WriteProcessMemory,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
  CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, Process32FirstW, Process32NextW,
  Thread32First, Thread32Next, MODULEENTRY32W, PROCESSENTRY32W, THREADENTRY32, TH32CS_SNAPMODULE,
  TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS, TH32CS_SNAPTHREAD,
};
use windows_sys::Win32::System::Memory::{VirtualProtectEx};
use windows_sys::Win32::System::Threading::OpenThread;
use windows_sys::Win32::System::Threading::{ResumeThread, SuspendThread, THREAD_SUSPEND_RESUME};

pub(crate) fn read_wide(buf: &[u16]) -> String {
  let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
  String::from_utf16_lossy(&buf[..len])
}

pub(crate) fn find_pid_by_window_class(class_name: &str) -> Option<u32> {
  struct Search {
    class_name: String,
    pid: u32,
  }

  unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: isize) -> BOOL {
    let search = &mut *(lparam as *mut Search);
    let mut buffer = [0u16; 256];
    let len = windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW(
      hwnd,
      buffer.as_mut_ptr(),
      buffer.len() as i32,
    );
    if len > 0 {
      let current = read_wide(&buffer);
      if current == search.class_name {
        let mut pid = 0u32;
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != 0 {
          search.pid = pid;
          return 0;
        }
      }
    }
    1
  }

  let mut search = Box::new(Search {
    class_name: class_name.to_string(),
    pid: 0,
  });
  let ptr = &mut *search as *mut Search as isize;
  unsafe {
    windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows(Some(enum_proc), ptr);
  }
  if search.pid == 0 { None } else { Some(search.pid) }
}

pub(crate) fn find_pid_by_name(process_name: &str) -> Option<u32> {
  unsafe {
    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if snapshot == 0 || snapshot == -1 {
      return None;
    }
    let mut entry = PROCESSENTRY32W {
      dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
      ..std::mem::zeroed()
    };
    if Process32FirstW(snapshot, &mut entry) == 0 {
      CloseHandle(snapshot);
      return None;
    }
    let target = process_name.to_ascii_lowercase();
    loop {
      let name = read_wide(&entry.szExeFile).to_ascii_lowercase();
      if name == target {
        CloseHandle(snapshot);
        return Some(entry.th32ProcessID);
      }
      if Process32NextW(snapshot, &mut entry) == 0 {
        break;
      }
    }
    CloseHandle(snapshot);
  }
  None
}

pub(crate) fn get_module_base(pid: u32, module_name: &str) -> Option<usize> {
  unsafe {
    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    if snapshot == 0 || snapshot == -1 {
      return None;
    }
    let mut entry = MODULEENTRY32W {
      dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
      ..std::mem::zeroed()
    };
    if Module32FirstW(snapshot, &mut entry) == 0 {
      CloseHandle(snapshot);
      return None;
    }
    let target = module_name.to_ascii_lowercase();
    loop {
      let name = read_wide(&entry.szModule).to_ascii_lowercase();
      if name == target {
        CloseHandle(snapshot);
        return Some(entry.modBaseAddr as usize);
      }
      if Module32NextW(snapshot, &mut entry) == 0 {
        break;
      }
    }
    CloseHandle(snapshot);
  }
  None
}

pub(crate) fn read_bytes(handle: isize, address: usize, size: usize) -> Result<Vec<u8>, String> {
  let mut buffer = vec![0u8; size];
  let mut read = 0usize;
  let ok = unsafe {
    ReadProcessMemory(
      handle,
      address as *const _,
      buffer.as_mut_ptr() as *mut _,
      size,
      &mut read,
    )
  };
  if ok == 0 || read != size {
    return Err("Failed to read process memory".to_string());
  }
  Ok(buffer)
}

pub(crate) fn write_bytes(handle: isize, address: usize, bytes: &[u8]) -> Result<(), String> {
  let mut old_protect = 0u32;
  let protect_ok = unsafe {
    VirtualProtectEx(
      handle,
      address as *mut _,
      bytes.len(),
      windows_sys::Win32::System::Memory::PAGE_EXECUTE_READWRITE,
      &mut old_protect,
    )
  };
  if protect_ok == 0 {
    return Err("Failed to change memory protection".to_string());
  }

  let mut written = 0usize;
  let ok = unsafe {
    WriteProcessMemory(
      handle,
      address as *mut _,
      bytes.as_ptr() as *const _,
      bytes.len(),
      &mut written,
    )
  };

  unsafe {
    FlushInstructionCache(handle, address as *const _, bytes.len());
    let mut _restore = 0u32;
    VirtualProtectEx(
      handle,
      address as *mut _,
      bytes.len(),
      old_protect,
      &mut _restore,
    );
  }

  if ok == 0 || written != bytes.len() {
    return Err("Failed to write process memory".to_string());
  }
  Ok(())
}

pub(crate) fn apply_patch_at(
  handle: &mut crate::app::state::ProcessHandle,
  address: usize,
  bytes: &[u8],
  enabled: bool,
) -> Result<(), String> {
  if enabled {
    if !handle.original.contains_key(&address) {
      let original = read_bytes(handle.handle, address, bytes.len())?;
      handle.original.insert(address, original);
    }
    write_bytes(handle.handle, address, bytes)?;
    return Ok(());
  }
  if let Some(original) = handle.original.remove(&address) {
    write_bytes(handle.handle, address, &original)?;
  }
  Ok(())
}

pub(crate) fn suspend_process_threads(pid: u32) -> Vec<isize> {
  let mut handles = Vec::new();
  unsafe {
    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if snapshot == 0 || snapshot == -1 {
      return handles;
    }
    let mut entry = THREADENTRY32 {
      dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
      ..std::mem::zeroed()
    };
    if Thread32First(snapshot, &mut entry) == 0 {
      CloseHandle(snapshot);
      return handles;
    }
    loop {
      if entry.th32OwnerProcessID == pid {
        let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
        if thread != 0 {
          SuspendThread(thread);
          handles.push(thread);
        }
      }
      if Thread32Next(snapshot, &mut entry) == 0 {
        break;
      }
    }
    CloseHandle(snapshot);
  }
  handles
}

pub(crate) fn resume_process_threads(handles: Vec<isize>) {
  for handle in handles {
    unsafe {
      ResumeThread(handle);
      CloseHandle(handle);
    }
  }
}
