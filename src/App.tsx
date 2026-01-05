import type { ReactElement } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut'
import { listen } from '@tauri-apps/api/event'
import './App.css'

type AttachResponse = {
  pid: number
  base: number
}

type FeatureOperation =
  | { type: 'patch'; offset: number; bytes: number[] }
  | { type: 'nop'; offset: number; size: number }
  | { type: 'float'; offset: number; value: number }

type FeatureToggle = {
  id: string
  label: string
  desc: string
  ops: FeatureOperation[]
}

type CategoryKey =
  | 'overview'
  | 'player'
  | 'settings'

type ThemeKey = 'aqua' | 'ember' | 'aurora' | 'noir' | 'sunrise' | 'glacier'
type AppSettings = {
  theme: ThemeKey | string
  alwaysOnTop: boolean
  reduceMotion: boolean
  nonActivateWindow: boolean
  appScale: number
  featureHotkeys: Record<string, string>
}

type ForegroundWindow = {
  className: string
}

const categories: { id: CategoryKey; label: string; icon: ReactElement }[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="8" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
        <rect x="13" y="13" width="8" height="8" rx="2" />
      </svg>
    ),
  },
  {
    id: 'player',
    label: 'Player',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0v1H4z" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"
        />
        <path
          d="M4.9 12c0-.4 0-.8.1-1.2l-2.2-1.7 2-3.4 2.7 1a7.7 7.7 0 0 1 2.1-1.2l.4-2.8h4l.4 2.8c.8.3 1.5.7 2.1 1.2l2.7-1 2 3.4-2.2 1.7c.1.4.1.8.1 1.2s0 .8-.1 1.2l2.2 1.7-2 3.4-2.7-1a7.7 7.7 0 0 1-2.1 1.2l-.4 2.8h-4l-.4-2.8a7.7 7.7 0 0 1-2.1-1.2l-2.7 1-2-3.4 2.2-1.7c-.1-.4-.1-.8-.1-1.2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
]

const themeOptions: Array<{
  id: ThemeKey
  label: string
  desc: string
}> = [
  {
    id: 'aqua',
    label: 'Aether Aqua',
    desc: 'Cool teal glow with neutral shadows.',
  },
  {
    id: 'ember',
    label: 'Ember Signal',
    desc: 'Warm amber highlights with deeper contrast.',
  },
  {
    id: 'aurora',
    label: 'Aurora Mint',
    desc: 'Soft mint accents with luminous haze.',
  },
  {
    id: 'noir',
    label: 'Noir Pulse',
    desc: 'High contrast graphite with neon edge.',
  },
  {
    id: 'sunrise',
    label: 'Sunrise Bloom',
    desc: 'Warm coral highlights with pastel lift.',
  },
  {
    id: 'glacier',
    label: 'Glacier Drift',
    desc: 'Cool sapphire glow with crisp clarity.',
  },
]

const playerToggles: FeatureToggle[] = [
  {
    id: 'godmode',
    label: 'Godmode',
    desc: 'Enables invincibility against all damage sources',
    ops: [{ type: 'patch', offset: 0x2ff40e2, bytes: [0x01] }],
  },
  {
    id: 'infinite-energy',
    label: 'Infinite Energy',
    desc: 'Never run out of wing energy',
    ops: [{ type: 'patch', offset: 0x2ff40e1, bytes: [0x01] }],
  },
  {
    id: 'infinite-breath',
    label: 'Infinite Breath',
    desc: 'Never run out of breath underwater',
    ops: [{ type: 'nop', offset: 0x1a5dad2, size: 6 }],
  },
  {
    id: 'anti-rain',
    label: 'Anti Rain Drain',
    desc: 'Prevents rain from draining your light',
    ops: [{ type: 'patch', offset: 0x2ff40e6, bytes: [0x01] }],
  },
  {
    id: 'anti-afk',
    label: 'Anti AFK',
    desc: 'Prevents entering AFK state when idle',
    ops: [{ type: 'patch', offset: 0x286b3fc, bytes: [0x00] }],
  },
]

const movementToggles: FeatureToggle[] = [
  {
    id: 'super-jump',
    label: 'Super Jump',
    desc: 'Jump further',
    ops: [
      {
        type: 'patch',
        offset: 0x23117ec,
        bytes: [0x00, 0x00, 0x20, 0x41, 0x9a],
      },
    ],
  },
  {
    id: 'super-swim',
    label: 'Super Swim',
    desc: 'Swim faster',
    ops: [
      {
        type: 'patch',
        offset: 0x27bd7e0,
        bytes: [0x00, 0x00, 0x48, 0x42, 0x6f],
      },
    ],
  },
  {
    id: 'super-flight',
    label: 'Super Flight',
    desc: 'Fly faster',
    ops: [
      {
        type: 'patch',
        offset: 0xa5c842,
        bytes: [0xc7, 0x01, 0x00, 0x00, 0xc8, 0x42],
      },
    ],
  },
  {
    id: 'anti-sink',
    label: 'Anti Sink',
    desc: 'Prevents sinking in water',
    ops: [{ type: 'float', offset: 0x27bda30, value: 100.0 }],
  },
]

const cameraToggles: FeatureToggle[] = [
  {
    id: 'disable-cam-snap',
    label: 'Disable Camera Snapping',
    desc: 'Prevents camera from automatically snapping',
    ops: [{ type: 'patch', offset: 0x27a7885, bytes: [0x00] }],
  },
  {
    id: 'free-zoom',
    label: 'Disable Zoom Restrictions',
    desc: 'Removes limits on camera zoom',
    ops: [{ type: 'nop', offset: 0x3579d5, size: 9 }],
  },
  {
    id: 'disable-cam-rotation',
    label: 'Disable Camera Rotation',
    desc: 'Prevents camera from rotating',
    ops: [{ type: 'nop', offset: 0x3530c8, size: 2 }],
  },
  {
    id: 'first-person',
    label: 'First Person',
    desc: 'Enables first-person camera mode',
    ops: [{ type: 'nop', offset: 0x2311854, size: 5 }],
  },
]

const settingsToggles: FeatureToggle[] = [
  {
    id: 'show-cursor',
    label: 'Show Cursor',
    desc: 'Keeps the system cursor visible while in-game.',
    ops: [{ type: 'patch', offset: 0x2f96890, bytes: [0x01] }],
  },
]

const DEFAULT_WINDOW_SIZE = { width: 1000, height: 760 }
const COLLAPSE_HOTKEY_ID = 'toggle-collapse'

function App() {
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryKey>('overview')
  const [playerTab, setPlayerTab] = useState<'core' | 'camera'>('core')
  const [activeToggles, setActiveToggles] = useState<Record<string, boolean>>(
    {}
  )
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<ThemeKey>('aqua')
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [nonActivateWindow, setNonActivateWindow] = useState(false)
  const [appScale, setAppScale] = useState(1)
  const [featureHotkeys, setFeatureHotkeys] = useState<Record<string, string>>(
    {}
  )
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'window' | 'input' | 'display'>('appearance')
  const [collapsed, setCollapsed] = useState(false)
  const [expanding, setExpanding] = useState(false)
  const expandedSizeRef = useRef<{ width: number; height: number } | null>(null)
  const prevAppScaleRef = useRef(1)
  const baseWindowSizeRef = useRef<{ width: number; height: number } | null>(
    null
  )
  const scalingWindowRef = useRef(false)
  const windowAnimatingRef = useRef(false)
  const resizeDebounceRef = useRef<number | null>(null)
  const [listeningHotkey, setListeningHotkey] = useState<string | null>(null)
  const activeTogglesRef = useRef<Record<string, boolean>>({})
  const [hotkeysActive, setHotkeysActive] = useState(false)
  const [hotkeyCaptureActive, setHotkeyCaptureActive] = useState(false)
  const [focusActive, setFocusActive] = useState(false)
  const nonActivateRestoreRef = useRef<boolean | null>(null)
  const hotkeyLastTriggerRef = useRef<Record<string, number>>({})
  const [attached, setAttached] = useState(false)
  const [pid, setPid] = useState<number | null>(null)
  const [superRunEnabled, setSuperRunEnabled] = useState(false)
  const [pendingSuperRunSpeed, setPendingSuperRunSpeed] = useState(20)
  const [toasts, setToasts] = useState<{ id: number; message: string; variant: 'error' | 'success' }[]>([])

  const [categoryDirection, setCategoryDirection] = useState<'left' | 'right'>(
    'right'
  )
  const [subtabIndicator, setSubtabIndicator] = useState({ left: 0, width: 0 })
  const [settingsTabIndicator, setSettingsTabIndicator] = useState({
    left: 0,
    width: 0,
  })
  const prevCategoryRef = useRef<CategoryKey>('overview')
  const prevPlayerTabRef = useRef<'core' | 'camera'>('core')
  const subtabRef = useRef<HTMLDivElement | null>(null)
  const subtabCoreRef = useRef<HTMLButtonElement | null>(null)
  const subtabCameraRef = useRef<HTMLButtonElement | null>(null)
  const settingsSubtabRef = useRef<HTMLDivElement | null>(null)
  const settingsAppearanceRef = useRef<HTMLButtonElement | null>(null)
  const settingsWindowRef = useRef<HTMLButtonElement | null>(null)
  const settingsInputRef = useRef<HTMLButtonElement | null>(null)
  const settingsDisplayRef = useRef<HTMLButtonElement | null>(null)

  const addToast = (message: string, variant: 'error' | 'success') => {
    const id = Date.now()
    setToasts((current) => [...current, { id, message, variant }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4000)
  }

  const handleWindowAction = async (action: 'minimize' | 'close') => {
    if (!(await isTauri())) return
    const appWindow = getCurrentWindow()
    if (action === 'minimize') {
      await appWindow.minimize()
      return
    }
    await appWindow.close()
  }

  const getLogicalOuterSize = async () => {
    const appWindow = getCurrentWindow()
    const size = await appWindow.outerSize()
    const scale = await appWindow.scaleFactor()
    const logical = size.toLogical(scale)
    return { width: Math.round(logical.width), height: Math.round(logical.height) }
  }

  const handleCollapseToggle = async () => {
    if (!(await isTauri())) return
    const appWindow = getCurrentWindow()
    const animateWindowSize = async (
      from: { width: number; height: number },
      to: { width: number; height: number },
      durationMs: number
    ) => {
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
      const steps = Math.max(6, Math.round(durationMs / 40))
      const delayMs = Math.max(10, Math.round(durationMs / steps))
      let lastWidth = -1
      let lastHeight = -1
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps
        const eased = easeOutCubic(progress)
        const width = Math.round(from.width + (to.width - from.width) * eased)
        const height = Math.round(from.height + (to.height - from.height) * eased)
        if (width !== lastWidth || height !== lastHeight) {
          lastWidth = width
          lastHeight = height
          await appWindow.setSize(new LogicalSize(width, height))
        }
        await new Promise<void>((resolve) =>
          window.setTimeout(() => resolve(), delayMs)
        )
      }
    }
    if (!collapsed) {
      setExpanding(false)
      if (!baseWindowSizeRef.current) {
        baseWindowSizeRef.current = { ...DEFAULT_WINDOW_SIZE }
      }
      expandedSizeRef.current = {
        width: Math.round(baseWindowSizeRef.current.width * appScale),
        height: Math.round(baseWindowSizeRef.current.height * appScale),
      }
      setCollapsed(true)
      const current = await getLogicalOuterSize()
      const targetWidth = Math.round(520 * appScale)
      const targetHeight = Math.round(56 * appScale)
      windowAnimatingRef.current = true
      try {
        await animateWindowSize(
          { width: current.width, height: current.height },
          { width: targetWidth, height: targetHeight },
          220
        )
      } finally {
        windowAnimatingRef.current = false
      }
      return
    }
    const target =
      expandedSizeRef.current ??
      (baseWindowSizeRef.current
        ? {
            width: Math.round(baseWindowSizeRef.current.width * appScale),
            height: Math.round(baseWindowSizeRef.current.height * appScale),
          }
        : {
            width: Math.round(DEFAULT_WINDOW_SIZE.width * appScale),
            height: Math.round(DEFAULT_WINDOW_SIZE.height * appScale),
          })
    setExpanding(true)
    setCollapsed(false)
    const current = await getLogicalOuterSize()
    windowAnimatingRef.current = true
    try {
      await animateWindowSize(
        { width: current.width, height: current.height },
        { width: target.width, height: target.height },
        260
      )
    } finally {
      windowAnimatingRef.current = false
      expandedSizeRef.current = target
    }
    setExpanding(false)
  }

  const handleDrag = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (!(await isTauri())) return
    const appWindow = getCurrentWindow()
    await appWindow.startDragging()
  }

  const applyOperation = async (operation: FeatureOperation, enabled: boolean) => {
    if (!attached) return
    if (operation.type === 'patch') {
      await invoke('apply_patch', {
        offset: operation.offset,
        bytes: operation.bytes,
        enabled,
      })
      return
    }
    if (operation.type === 'nop') {
      await invoke('apply_nop', {
        offset: operation.offset,
        size: operation.size,
        enabled,
      })
      return
    }
    await invoke('apply_float', {
      offset: operation.offset,
      value: operation.value,
      enabled,
    })
  }

  const handleToggleState = async (feature: FeatureToggle, next: boolean) => {
    if (!attached) return
    const current = Boolean(activeTogglesRef.current[feature.id])
    if (current === next) return
    setActiveToggles((current) => ({ ...current, [feature.id]: next }))
    try {
      for (const operation of feature.ops) {
        await applyOperation(operation, next)
      }
    } catch (err) {
      setActiveToggles((current) => ({ ...current, [feature.id]: !next }))
      addToast(
        err instanceof Error
          ? err.message
          : 'Failed to apply feature. Reattach and try again.',
        'error'
      )
    }
  }

  const handleBulkToggle = async (features: FeatureToggle[]) => {
    if (!attached || features.length === 0) return
    const shouldEnable = features.some(
      (feature) => !Boolean(activeToggles[feature.id])
    )
    for (const feature of features) {
      await handleToggleState(feature, shouldEnable)
    }
  }

  const isGroupActive = (features: FeatureToggle[]) =>
    features.length > 0 &&
    features.every((feature) => Boolean(activeToggles[feature.id]))

  const handleCardToggle = (feature: FeatureToggle) => {
    handleToggleState(feature, !Boolean(activeToggles[feature.id]))
  }

const hotkeyTargetById = useMemo(() => {
    const entries = [
      ...playerToggles,
      ...movementToggles,
      ...cameraToggles,
      ...settingsToggles,
    ]
    
    type HotkeyTarget = 
      | { type: 'feature'; feature: FeatureToggle }
      | { type: 'action'; action: () => void }
    
    const map = new Map<string, HotkeyTarget>()
    
    for (const feature of entries) {
      map.set(feature.id, { type: 'feature', feature })
    }
    map.set(COLLAPSE_HOTKEY_ID, {
      type: 'action',
      action: () => handleCollapseToggle(),
    })
    return map
  }, [handleCollapseToggle])

  useEffect(() => {
    activeTogglesRef.current = activeToggles
  }, [activeToggles])

  useEffect(() => {
    if (!listeningHotkey) return
    setHotkeyCaptureActive(true)
    if (nonActivateRestoreRef.current === null) {
      nonActivateRestoreRef.current = nonActivateWindow
    }
    if (nonActivateWindow) {
      setNonActivateWindow(false)
    }
    if (isTauri()) {
      unregisterAll().catch(() => {})
    }
    const handler = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setListeningHotkey(null)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        setFeatureHotkeys((current) => {
          const next = { ...current }
          delete next[listeningHotkey]
          return next
        })
        setListeningHotkey(null)
        return
      }
      if (
        event.key === 'Shift' ||
        event.key === 'Control' ||
        event.key === 'Alt' ||
        event.key === 'Meta'
      ) {
        return
      }
      let key = event.key
      if (key === ' ') {
        key = 'Space'
      }
      if (key.length === 1) {
        key = key.toUpperCase()
      }
      const parts = []
      if (event.ctrlKey) parts.push('Ctrl')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      if (event.metaKey) parts.push('Meta')
      parts.push(key)
      const hotkey = parts.join('+')
      setFeatureHotkeys((current) => ({ ...current, [listeningHotkey]: hotkey }))
      setListeningHotkey(null)
    }
    const mouseHandler = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      let hotkey: string | null = null
      if (event.button === 1) hotkey = 'Mouse3'
      if (event.button === 3) hotkey = 'Mouse4'
      if (event.button === 4) hotkey = 'Mouse5'
      if (!hotkey) return
      setFeatureHotkeys((current) => ({ ...current, [listeningHotkey]: hotkey }))
      setListeningHotkey(null)
    }
    window.addEventListener('keydown', handler)
    window.addEventListener('mousedown', mouseHandler)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('mousedown', mouseHandler)
      if (nonActivateRestoreRef.current !== null) {
        setNonActivateWindow(nonActivateRestoreRef.current)
        nonActivateRestoreRef.current = null
      }
      setHotkeyCaptureActive(false)
    }
  }, [listeningHotkey])

  useEffect(() => {
    const registerHotkeys = async () => {
      if (!(await isTauri())) return
      await unregisterAll().catch(() => {})
      if (hotkeyCaptureActive) return
      const entries = Object.entries(featureHotkeys)
      if (entries.length === 0) return
      const used = new Set<string>()
      for (const [id, hotkey] of entries) {
        const target = hotkeyTargetById.get(id)
        if (!target || !hotkey) continue
        if (target.type === 'feature' && !hotkeysActive) {
          continue
        }
        if (used.has(hotkey)) {
          continue
        }
        used.add(hotkey)
        if (hotkey.startsWith('Mouse')) {
          continue
        }
        try {
          await register(hotkey, () => {
            const now = Date.now()
            const last = hotkeyLastTriggerRef.current[id] ?? 0
            if (now - last < 250) return
            hotkeyLastTriggerRef.current[id] = now
            if (target.type === 'feature') {
              const current = Boolean(activeTogglesRef.current[id])
              void handleToggleState(target.feature, !current)
              return
            }
            if (!focusActive) return
            target.action()
          })
        } catch (err) {
          console.warn('Failed to register hotkey', hotkey, err)
        }
      }
    }
    registerHotkeys()
  }, [
    featureHotkeys,
    hotkeyTargetById,
    attached,
    hotkeysActive,
    focusActive,
    hotkeyCaptureActive,
  ])

  useEffect(() => {
    let active = true
    let interval: number | undefined
    const check = async () => {
      if (!(await isTauri())) return
      const window = getCurrentWindow()
      const focused = await window.isFocused().catch(() => false)
      let gameFocused = false
      if (attached) {
        try {
          const result = await invoke<ForegroundWindow>(
            'get_foreground_window_class'
          )
          gameFocused = result.className === 'TgcMainWindow'
        } catch {
          gameFocused = false
        }
      }
      if (!active) return
      const focusState = focused || gameFocused
      setHotkeysActive(Boolean(attached && focusState))
      setFocusActive(Boolean(focusState))
    }
    check()
    interval = window.setInterval(check, 500)
    return () => {
      active = false
      if (interval) window.clearInterval(interval)
    }
  }, [attached])

  useEffect(() => {
    let unlistenPromise: Promise<() => void> | null = null
    let active = true
    const setup = async () => {
      if (!(await isTauri())) return
      if (!active) return
      unlistenPromise = listen<string>('mouse-hotkey', (event) => {
        if (hotkeyCaptureActive) return
        const key = event.payload
        const entry = Object.entries(featureHotkeys).find(
          ([, hotkey]) => hotkey === key
        )
        if (!entry) return
        const [id] = entry
        const target = hotkeyTargetById.get(id)
        if (!target) return
        if (target.type === 'feature' && !hotkeysActive) return
        if (target.type !== 'feature' && !focusActive) return
        const now = Date.now()
        const last = hotkeyLastTriggerRef.current[id] ?? 0
        if (now - last < 250) return
        hotkeyLastTriggerRef.current[id] = now
        if (target.type === 'feature') {
          const current = Boolean(activeTogglesRef.current[id])
          void handleToggleState(target.feature, !current)
          return
        }
        target.action()
      })
    }
    setup()
    return () => {
      active = false
      if (unlistenPromise) {
        void unlistenPromise.then((stop) => stop())
      }
    }
  }, [
    featureHotkeys,
    hotkeyTargetById,
    hotkeysActive,
    hotkeyCaptureActive,
    focusActive,
  ])

  const renderHotkeyButton = (id: string) => (
    <button
      className={`wm-hotkey ${
        listeningHotkey === id ? 'wm-hotkey--active' : ''
      }`}
      onClick={(event) => {
        event.stopPropagation()
        if (isTauri()) {
          getCurrentWindow().setFocus().catch(() => {})
        }
        setListeningHotkey(id)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setFeatureHotkeys((current) => {
          const next = { ...current }
          delete next[id]
          return next
        })
      }}
      type="button"
    >
      {listeningHotkey === id ? 'Press keys...' : featureHotkeys[id] || 'Bind'}
    </button>
  )

  const renderFeatureCard = (feature: FeatureToggle) => (
    <div
      className="wm-card wm-card--clickable"
      data-active={activeToggles[feature.id] ? 'true' : 'false'}
      key={feature.id}
      role="button"
      tabIndex={0}
      onClick={() => handleCardToggle(feature)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleCardToggle(feature)
        }
      }}
    >
      <div>
        <h3>{feature.label}</h3>
        <p>{feature.desc}</p>
      </div>
      <div className="wm-card__controls">
        <div
          className="wm-toggle"
          data-active={activeToggles[feature.id] ? 'true' : 'false'}
          aria-label={`${feature.label} toggle`}
        >
          <span className="wm-toggle__indicator" />
          <button
            className="wm-toggle__button wm-toggle__button--off"
            onClick={(event) => {
              event.stopPropagation()
              handleToggleState(feature, false)
            }}
            disabled={!attached}
            type="button"
          >
            Off
          </button>
          <button
            className="wm-toggle__button wm-toggle__button--on"
            onClick={(event) => {
              event.stopPropagation()
              handleToggleState(feature, true)
            }}
            disabled={!attached}
            type="button"
          >
            On
          </button>
        </div>
        {renderHotkeyButton(feature.id)}
      </div>
    </div>
  )

  const renderSettingsToggle = (
    label: string,
    desc: string,
    value: boolean,
    onChange: (next: boolean) => void
  ) => (
    <div className="wm-card wm-settings-card">
      <div>
        <h3>{label}</h3>
        <p>{desc}</p>
      </div>
      <div className="wm-toggle" data-active={value ? 'true' : 'false'}>
        <span className="wm-toggle__indicator" />
        <button
          className="wm-toggle__button wm-toggle__button--off"
          onClick={() => onChange(false)}
          type="button"
        >
          Off
        </button>
        <button
          className="wm-toggle__button wm-toggle__button--on"
          onClick={() => onChange(true)}
          type="button"
        >
          On
        </button>
      </div>
    </div>
  )

  const formatError = (err: unknown, fallback: string) => {
    if (err instanceof Error) return err.message
    if (typeof err === 'string') return err
    if (err && typeof err === 'object') {
      const message = (err as { message?: unknown }).message
      if (typeof message === 'string') return message
      const error = (err as { error?: unknown }).error
      if (typeof error === 'string') return error
      try {
        return JSON.stringify(err)
      } catch {
        return fallback
      }
    }
    return fallback
  }

  const handleSuperRunApply = async () => {
    if (!attached) return
    try {
      const value = pendingSuperRunSpeed
      if (!superRunEnabled) {
        setSuperRunEnabled(true)
        await applyOperation(
          { type: 'patch', offset: 0x27bd818, bytes: [0x00] },
          true
        )
      }
      await invoke('set_run_speed', { value })
    } catch (err) {
      addToast(
        err instanceof Error
          ? err.message
          : 'Failed to apply Super Run speed.',
        'error'
      )
    }
  }

  const handleSuperRunReset = async () => {
    if (!attached) return
    try {
      setSuperRunEnabled(false)
      await applyOperation(
        { type: 'patch', offset: 0x27bd818, bytes: [0x00] },
        false
      )
      const value = 3.5
      setPendingSuperRunSpeed(value)
      await invoke('reset_run_speed')
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to reset Super Run.',
        'error'
      )
    }
  }

  const handleAttach = async () => {
    try {
      const response = await invoke<AttachResponse>('attach_process')
      setAttached(true)
      setPid(response.pid)
      addToast('Attached to Sky.exe', 'success')
    } catch {
      addToast('Sky.exe not found. Launch the game and try again.', 'error')
    }
  }

  const handleDetach = async () => {
    await invoke('detach_process')
    setAttached(false)
    setPid(null)
    addToast('Detached from Sky.exe', 'success')
  }

  const handleLaunchGame = async () => {
    try {
      await invoke('launch_game')
      addToast('Launching Sky from Steam...', 'success')
    } catch (err) {
      addToast(formatError(err, 'Failed to launch Sky.'), 'error')
    }
  }

  const handleCloseGame = async () => {
    try {
      await invoke('close_game')
      addToast('Closed Sky.exe', 'success')
    } catch (err) {
      addToast(formatError(err, 'Failed to close Sky.exe.'), 'error')
    }
  }

  useEffect(() => {
    const prev = prevCategoryRef.current
    if (prev !== selectedCategory) {
      const prevIndex = categories.findIndex((item) => item.id === prev)
      const nextIndex = categories.findIndex(
        (item) => item.id === selectedCategory
      )
      if (prevIndex !== -1 && nextIndex !== -1) {
        setCategoryDirection(nextIndex > prevIndex ? 'right' : 'left')
      }
      prevCategoryRef.current = selectedCategory
    }
  }, [selectedCategory])

  useEffect(() => {
    if (selectedCategory !== 'player') return
    prevPlayerTabRef.current = playerTab
  }, [playerTab, selectedCategory])

  const updateSubtabIndicator = () => {
    const container = subtabRef.current
    if (!container) return
    const target =
      playerTab === 'core'
        ? subtabCoreRef.current
        : subtabCameraRef.current
    if (!target) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const scale = appScale || 1
    setSubtabIndicator({
      left: (targetRect.left - containerRect.left) / scale,
      width: targetRect.width / scale,
    })
  }

  const updateSettingsTabIndicator = () => {
    const container = settingsSubtabRef.current
    if (!container) return
    const target =
      settingsTab === 'appearance'
        ? settingsAppearanceRef.current
        : settingsTab === 'window'
          ? settingsWindowRef.current
          : settingsTab === 'input'
            ? settingsInputRef.current
            : settingsDisplayRef.current
    if (!target) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const scale = appScale || 1
    setSettingsTabIndicator({
      left: (targetRect.left - containerRect.left) / scale,
      width: targetRect.width / scale,
    })
  }

  useLayoutEffect(() => {
    if (selectedCategory !== 'player') return
    updateSubtabIndicator()
  }, [selectedCategory, playerTab, appScale])

  useLayoutEffect(() => {
    if (selectedCategory !== 'settings') return
    updateSettingsTabIndicator()
  }, [selectedCategory, settingsTab, appScale])

  useEffect(() => {
    if (selectedCategory !== 'player') return
    const handleResize = () => updateSubtabIndicator()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [selectedCategory, playerTab, appScale])

  useEffect(() => {
    if (selectedCategory !== 'settings') return
    const handleResize = () => updateSettingsTabIndicator()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [selectedCategory, settingsTab, appScale])

  const queryValue = query.trim().toLowerCase()
  const matchesQuery = (text: string) =>
    text.toLowerCase().includes(queryValue)

  const filterToggles = (list: FeatureToggle[]) =>
    queryValue.length === 0
      ? list
      : list.filter(
          (item) => matchesQuery(item.label) || matchesQuery(item.desc)
        )

  const filteredPlayer = useMemo(
    () => filterToggles(playerToggles),
    [queryValue]
  )
  const filteredMovement = useMemo(
    () => filterToggles(movementToggles),
    [queryValue]
  )
  const filteredCamera = useMemo(
    () => filterToggles(cameraToggles),
    [queryValue]
  )

  const activeCount =
    Object.values(activeToggles).filter(Boolean).length +
    (superRunEnabled ? 1 : 0)

  const selectedLabel = categories.find(
    (category) => category.id === selectedCategory
  )?.label

  const isThemeKey = (value: string): value is ThemeKey =>
    value === 'aqua' ||
    value === 'ember' ||
    value === 'aurora' ||
    value === 'noir' ||
    value === 'sunrise' ||
    value === 'glacier'

  const clampAppScale = (value: number) => {
    if (!Number.isFinite(value)) return 1
    return Math.min(1.4, Math.max(0.8, value))
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      if (await isTauri()) {
        try {
          const settings = await invoke<AppSettings>('load_settings')
          if (!active) return
          const nextTheme = isThemeKey(settings.theme)
            ? settings.theme
            : 'aqua'
          setTheme(nextTheme)
          setAlwaysOnTop(Boolean(settings.alwaysOnTop))
          setReduceMotion(Boolean(settings.reduceMotion))
          setNonActivateWindow(Boolean(settings.nonActivateWindow))
          setAppScale(clampAppScale(Number(settings.appScale)))
          setFeatureHotkeys(settings.featureHotkeys ?? {})
        } catch {
          if (!active) return
          setTheme('aqua')
          setAlwaysOnTop(false)
          setReduceMotion(false)
          setNonActivateWindow(false)
          setAppScale(1)
          setFeatureHotkeys({})
        }
        if (active) setSettingsLoaded(true)
        return
      }
      if (typeof localStorage !== 'undefined') {
        const storedTheme = localStorage.getItem('tsm-theme')
        if (storedTheme && isThemeKey(storedTheme)) {
          setTheme(storedTheme)
        }
        const storedTop = localStorage.getItem('tsm-always-on-top')
        if (storedTop === 'true' || storedTop === 'false') {
          setAlwaysOnTop(storedTop === 'true')
        }
        const storedMotion = localStorage.getItem('tsm-reduce-motion')
        if (storedMotion === 'true' || storedMotion === 'false') {
          setReduceMotion(storedMotion === 'true')
        }
        const storedNonActivate = localStorage.getItem('tsm-non-activate')
        if (storedNonActivate === 'true' || storedNonActivate === 'false') {
          setNonActivateWindow(storedNonActivate === 'true')
        }
        const storedScale = localStorage.getItem('tsm-app-scale')
        if (storedScale) {
          setAppScale(clampAppScale(Number(storedScale)))
        }
        const storedHotkeys = localStorage.getItem('tsm-feature-hotkeys')
        if (storedHotkeys) {
          try {
            const parsed = JSON.parse(storedHotkeys)
            if (parsed && typeof parsed === 'object') {
              setFeatureHotkeys(parsed as Record<string, string>)
            }
          } catch {
            setFeatureHotkeys({})
          }
        }
      }
      if (active) setSettingsLoaded(true)
    }
    load()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.motion = reduceMotion ? 'reduced' : 'full'
  }, [reduceMotion])

  useEffect(() => {
    document.documentElement.style.setProperty('--app-scale', String(appScale))
  }, [appScale])

  useEffect(() => {
    const apply = async () => {
      if (!(await isTauri())) return
      const window = getCurrentWindow()
      window.setAlwaysOnTop(alwaysOnTop).catch(() => {})
    }
    apply()
  }, [alwaysOnTop])

  useEffect(() => {
    const apply = async () => {
      if (!(await isTauri())) return
      const window = getCurrentWindow()
      window.setFocusable(!nonActivateWindow).catch(() => {})
    }
    apply()
  }, [nonActivateWindow])

  useEffect(() => {
    if (!settingsLoaded || collapsed) return
    const apply = async () => {
      if (!(await isTauri())) return
      if (!baseWindowSizeRef.current) {
        baseWindowSizeRef.current = { ...DEFAULT_WINDOW_SIZE }
      }
      const target = {
        width: Math.round(baseWindowSizeRef.current.width * appScale),
        height: Math.round(baseWindowSizeRef.current.height * appScale),
      }
      expandedSizeRef.current = target
      const current = await getLogicalOuterSize()
      if (
        Math.abs(current.width - target.width) < 2 &&
        Math.abs(current.height - target.height) < 2
      ) {
        return
      }
      scalingWindowRef.current = true
      try {
        await getCurrentWindow().setSize(
          new LogicalSize(target.width, target.height)
        )
      } finally {
        scalingWindowRef.current = false
      }
    }
    void apply()
  }, [appScale, collapsed, settingsLoaded])

  useEffect(() => {
    if (!settingsLoaded) {
      prevAppScaleRef.current = appScale
      return
    }
    const apply = async () => {
      if (!(await isTauri())) {
        prevAppScaleRef.current = appScale
        return
      }
      if (windowAnimatingRef.current) {
        prevAppScaleRef.current = appScale
        return
      }
      if (Math.abs(appScale - prevAppScaleRef.current) < 0.001) return
      if (resizeDebounceRef.current) {
        window.clearTimeout(resizeDebounceRef.current)
      }
      resizeDebounceRef.current = window.setTimeout(async () => {
        if (!baseWindowSizeRef.current) {
          baseWindowSizeRef.current = { ...DEFAULT_WINDOW_SIZE }
        }
        const base = baseWindowSizeRef.current
const width = collapsed
          ? Math.round(520 * appScale)
          : Math.max(400, Math.round(base.width * appScale))
        const height = collapsed
          ? Math.round(56 * appScale)
          : Math.max(300, Math.round(base.height * appScale))
        scalingWindowRef.current = true
        try {
          await getCurrentWindow().setSize(new LogicalSize(width, height))
        } finally {
          scalingWindowRef.current = false
          prevAppScaleRef.current = appScale
        }
      }, 120)
    }
    void apply()
  }, [appScale, collapsed, settingsLoaded])

  useEffect(() => {
    if (!settingsLoaded) return
    if (hotkeyCaptureActive) return
    const persist = async () => {
      const settings: AppSettings = {
        theme,
        alwaysOnTop,
        reduceMotion,
        nonActivateWindow,
        appScale,
        featureHotkeys,
      }
      if (await isTauri()) {
        await invoke('save_settings', { settings }).catch(() => {})
        return
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('tsm-theme', theme)
        localStorage.setItem('tsm-always-on-top', String(alwaysOnTop))
        localStorage.setItem('tsm-reduce-motion', String(reduceMotion))
        localStorage.setItem('tsm-non-activate', String(nonActivateWindow))
        localStorage.setItem('tsm-app-scale', String(appScale))
        localStorage.setItem(
          'tsm-feature-hotkeys',
          JSON.stringify(featureHotkeys)
        )
      }
    }
    persist()
  }, [
    theme,
    alwaysOnTop,
    reduceMotion,
    nonActivateWindow,
    appScale,
    featureHotkeys,
    settingsLoaded,
    hotkeyCaptureActive,
  ])

  return (
    <div
      className={`window ${collapsed ? 'window--collapsed' : ''} ${
        expanding ? 'window--expanding' : ''
      }`}
    >
      <div className="toast-host">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.variant}`} key={toast.id}>
            {toast.message}
          </div>
        ))}
      </div>
      <div className="titlebar" data-tauri-drag-region>
        <div
          className="titlebar__drag"
          data-tauri-drag-region
          onMouseDown={handleDrag}
        >
          <div className="titlebar__app">
            <span className="titlebar__dot" />
            That Sky Mod - External Edition
          </div>
        </div>
        <div className="titlebar__controls">
          <button
            className="titlebar__button"
            onClick={() => handleWindowAction('minimize')}
            aria-label="Minimize"
            data-tauri-drag-region="false"
          >
            _
          </button>
          <button
            className="titlebar__button"
            onClick={handleCollapseToggle}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            data-tauri-drag-region="false"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 7h14" />
              <path d={collapsed ? 'M5 17h14' : 'M9 17h6'} />
            </svg>
          </button>
          <button
            className="titlebar__button titlebar__button--close"
            onClick={() => handleWindowAction('close')}
            aria-label="Close"
            data-tauri-drag-region="false"
          >
            X
          </button>
        </div>
      </div>

      <div className={`wm-shell ${appScale < 1 ? 'wm-shell--scaled' : ''}`}>
        <aside className="wm-sidebar">
          <nav className="wm-sidebar__nav">
            {categories.map((category) => (
              <button
                key={category.id}
                className={`wm-nav ${
                  selectedCategory === category.id ? 'active' : ''
                }`}
                onClick={() => setSelectedCategory(category.id)}
                aria-label={category.label}
              >
                <span className="wm-nav__icon" aria-hidden="true">
                  {category.icon}
                </span>
                <span className="sr-only">{category.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="wm-main">
          {selectedCategory === 'overview' ? (
            <div
              className={`wm-pane wm-pane--overview wm-pane--${categoryDirection}`}
              key="overview"
            >
              <header className="wm-hero">
                <div className="wm-hero__info">
                  <div className="wm-hero__eyebrow">Overview</div>
                  <h1>Session Control</h1>
                  <p>
                    Attach to Sky.exe, monitor session state, and keep tabs on
                    active features.
                  </p>
                  <div className="wm-hero__actions wm-hero__actions--grid">
                    <button
                      className="btn btn--primary"
                      onClick={handleAttach}
                      disabled={attached}
                    >
                      Attach
                    </button>
                    <button
                      className={`btn ${attached ? 'btn--danger' : 'btn--ghost'}`}
                      onClick={handleDetach}
                      disabled={!attached}
                    >
                      Detach
                    </button>
                    <button className="btn btn--ghost" onClick={handleLaunchGame}>
                      Launch via Steam
                    </button>
                    <button className="btn btn--danger" onClick={handleCloseGame}>
                      Close Game
                    </button>
                  </div>
                </div>
                <div className="wm-hero__card">
                  <div>
                    <span>Process</span>
                    <strong>{attached ? 'Attached' : 'Waiting'}</strong>
                    <small>{attached ? `PID ${pid ?? '-'}` : 'Sky.exe'}</small>
                  </div>
                  <div>
                    <span>Active</span>
                    <strong>{activeCount}</strong>
                    <small>Live toggles</small>
                  </div>
                  <div>
                    <span>Target</span>
                    <strong>Sky.exe</strong>
                    <small>TgcMainWindow</small>
                  </div>
                </div>
              </header>
              <section className="wm-overview-grid">
                <div className="wm-overview-card wm-quick-actions-card">
                  <h3>Quick Actions</h3>
                  <p>Jump straight into feature groups.</p>
                  <div className="wm-overview-actions">
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() => setSelectedCategory('player')}
                    >
                      Player Core
                    </button>
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        setSelectedCategory('player')
                        setPlayerTab('camera')
                      }}
                    >
                      Camera
                    </button>
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        setSelectedCategory('settings')
                        setSettingsTab('appearance')
                      }}
                    >
                      Appearance
                    </button>
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        setSelectedCategory('settings')
                        setSettingsTab('input')
                      }}
                    >
                      Input
                    </button>
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        setSelectedCategory('settings')
                        setSettingsTab('display')
                      }}
                    >
                      Display
                    </button>
                  </div>
                </div>
              </section>
              <div className="wm-overview-spacer" />
            </div>
          ) : (
            <div
              className={`wm-pane wm-pane--${categoryDirection}`}
              key={selectedCategory}
            >
              <header
                className={`wm-section-header${
                  selectedCategory !== 'player'
                    ? ' wm-section-header--solo'
                    : ''
                }`}
              >
                {selectedCategory === 'player' ? (
                  <>
                    <div className="wm-section-header__title">
                      <div className="wm-hero__eyebrow">Category</div>
                      <h1>{selectedLabel}</h1>
                    </div>
                    <div className="wm-section-header__row">
                      <div className="wm-subtabs" ref={subtabRef}>
                        <span
                          className="wm-subtabs__indicator"
                          style={{
                            width: `${subtabIndicator.width}px`,
                            transform: `translateX(${subtabIndicator.left}px)`,
                          }}
                        />
                        <button
                          ref={subtabCoreRef}
                          className={`wm-subtab ${
                            playerTab === 'core' ? 'active' : ''
                          }`}
                          onClick={() => setPlayerTab('core')}
                        >
                          Core
                        </button>
                        <button
                          ref={subtabCameraRef}
                          className={`wm-subtab ${
                            playerTab === 'camera' ? 'active' : ''
                          }`}
                          onClick={() => setPlayerTab('camera')}
                        >
                          Camera
                        </button>
                      </div>
                      <div className="wm-search">
                        <input
                          placeholder="Search features..."
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="wm-hero__eyebrow">Category</div>
                    <div className="wm-section-header__row">
                      <h1 className="wm-section-header__heading">
                        {selectedLabel}
                      </h1>
                      {selectedCategory !== 'settings' && (
                        <div className="wm-search wm-search--right">
                          <input
                            placeholder="Search features..."
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </header>
              <div className="wm-content">
                {selectedCategory === 'player' &&
                  (playerTab === 'core' ? (
                    <div className="wm-grid">
                      <section className="wm-section">
                        <header className="wm-section__header">
                          <div>
                            <h2>Protection & Safety</h2>
                            <p>Core survival toggles and safety helpers.</p>
                          </div>
                          <button
                            className="wm-section__action"
                            onClick={() => handleBulkToggle(filteredPlayer)}
                            disabled={!attached || filteredPlayer.length === 0}
                            type="button"
                            aria-label="Toggle all protection features"
                            data-active={
                              isGroupActive(filteredPlayer) ? 'true' : 'false'
                            }
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 3v7" />
                              <path d="M7.5 6.5a6.5 6.5 0 1 0 9 0" />
                            </svg>
                          </button>
                        </header>
                        <div className="wm-card-list">
                          {filteredPlayer.map(renderFeatureCard)}
                        </div>
                      </section>

                      <section className="wm-section">
                        <header className="wm-section__header">
                          <div>
                            <h2>Movement & Abilities</h2>
                            <p>Speed, jump height, and aerial boosts.</p>
                          </div>
                          <button
                            className="wm-section__action"
                            onClick={() => handleBulkToggle(filteredMovement)}
                            disabled={!attached || filteredMovement.length === 0}
                            type="button"
                            aria-label="Toggle all movement features"
                            data-active={
                              isGroupActive(filteredMovement) ? 'true' : 'false'
                            }
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 3v7" />
                              <path d="M7.5 6.5a6.5 6.5 0 1 0 9 0" />
                            </svg>
                          </button>
                        </header>
                        <div className="wm-card-list">
                          {filteredMovement.map(renderFeatureCard)}
                          <div className="wm-card wm-card--wide">
                            <div>
                              <h3>Super Run</h3>
                              <p>Run really fast</p>
                            </div>
                            <div className="wm-slider">
                              <input
                                type="range"
                                min="5"
                                max="60"
                                step="0.5"
                                value={pendingSuperRunSpeed}
                                onChange={(event) =>
                                  setPendingSuperRunSpeed(
                                    Number(event.target.value)
                                  )
                                }
                                disabled={!attached}
                              />
                              <div className="wm-slider__value">
                                {pendingSuperRunSpeed.toFixed(1)}x
                              </div>
                              <div className="wm-slider__actions">
                                <button
                                  className="btn btn--primary btn--small"
                                  onClick={handleSuperRunApply}
                                  disabled={!attached}
                                >
                                  Apply
                                </button>
                                <button
                                  className="btn btn--ghost btn--small"
                                  onClick={handleSuperRunReset}
                                  disabled={!attached}
                                >
                                  Reset
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>
                    </div>
                  ) : (
                    <section className="wm-section">
                      <header className="wm-section__header">
                        <div>
                          <h2>Camera Controls</h2>
                          <p>
                            Fine-tune the game camera for filming and precision.
                          </p>
                        </div>
                        <button
                          className="wm-section__action"
                          onClick={() => handleBulkToggle(filteredCamera)}
                          disabled={!attached || filteredCamera.length === 0}
                          type="button"
                          aria-label="Toggle all camera features"
                          data-active={
                            isGroupActive(filteredCamera) ? 'true' : 'false'
                          }
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 3v7" />
                            <path d="M7.5 6.5a6.5 6.5 0 1 0 9 0" />
                          </svg>
                        </button>
                      </header>
                      <div className="wm-card-list">
                        {filteredCamera.map(renderFeatureCard)}
                      </div>
                    </section>
                  ))}
                {selectedCategory === 'settings' && (
                  <div className="wm-settings">
                    <div className="wm-settings__tabs">
                      <div className="wm-subtabs" ref={settingsSubtabRef}>
                        <span
                          className="wm-subtabs__indicator"
                          style={{
                            width: `${settingsTabIndicator.width}px`,
                            transform: `translateX(${settingsTabIndicator.left}px)`,
                          }}
                        />
                        <button
                          ref={settingsAppearanceRef}
                          className={`wm-subtab ${
                            settingsTab === 'appearance' ? 'active' : ''
                          }`}
                          onClick={() => setSettingsTab('appearance')}
                          type="button"
                        >
                          Appearance
                        </button>
                        <button
                          ref={settingsWindowRef}
                          className={`wm-subtab ${
                            settingsTab === 'window' ? 'active' : ''
                          }`}
                          onClick={() => setSettingsTab('window')}
                          type="button"
                        >
                          Window
                        </button>
                        <button
                          ref={settingsInputRef}
                          className={`wm-subtab ${
                            settingsTab === 'input' ? 'active' : ''
                          }`}
                          onClick={() => setSettingsTab('input')}
                          type="button"
                        >
                          Input
                        </button>
                        <button
                          ref={settingsDisplayRef}
                          className={`wm-subtab ${
                            settingsTab === 'display' ? 'active' : ''
                          }`}
                          onClick={() => setSettingsTab('display')}
                          type="button"
                        >
                          Display
                        </button>
                      </div>
                    </div>
                    {settingsTab === 'appearance' && (
                      <section className="wm-section">
                        <header className="wm-section__header">
                          <div>
                            <h2>Appearance</h2>
                            <p>Choose the colorway and motion style.</p>
                          </div>
                        </header>
                        <div className="wm-card wm-card--wide wm-settings-theme">
                          <div>
                            <h3>Theme Preset</h3>
                            <p>Switch the accent glow and atmosphere.</p>
                          </div>
                          <div className="wm-theme-grid">
                            {themeOptions.map((option) => (
                              <button
                                key={option.id}
                                className={`wm-theme-option ${
                                  theme === option.id ? 'active' : ''
                                }`}
                                onClick={() => setTheme(option.id)}
                                data-theme={option.id}
                                type="button"
                              >
                                <span className="wm-theme-option__swatch" />
                                <span>
                                  <strong>{option.label}</strong>
                                  <small>{option.desc}</small>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="wm-card-list">
                          {renderSettingsToggle(
                            'Reduce Motion',
                            'Tone down transitions and animations.',
                            reduceMotion,
                            setReduceMotion
                          )}
                        </div>
                      </section>
                    )}
                    {settingsTab === 'window' && (
                      <section className="wm-section">
                        <header className="wm-section__header">
                          <div>
                            <h2>Window</h2>
                            <p>Control window focus and behavior.</p>
                          </div>
                        </header>
                        <div className="wm-card-list">
                          {renderSettingsToggle(
                            'Always On Top',
                            'Keep the tool visible above the game.',
                            alwaysOnTop,
                            setAlwaysOnTop
                          )}
                          {renderSettingsToggle(
                            'Non-Activate Window',
                            'Prevent focus so gameplay controls keep working.',
                            nonActivateWindow,
                            setNonActivateWindow
                          )}
                        </div>
                      </section>
                    )}
                    {settingsTab === 'input' && (
                      <section className="wm-section">
                        <header className="wm-section__header">
                          <div>
                            <h2>Input</h2>
                            <p>Mouse visibility and input helpers.</p>
                          </div>
                        </header>
                        <div className="wm-card-list">
                          <div className="wm-card">
                            <div>
                              <h3>Collapse Toggle</h3>
                              <p>Toggle the compact titlebar view.</p>
                            </div>
                            <div className="wm-card__controls">
                              {renderHotkeyButton(COLLAPSE_HOTKEY_ID)}
                            </div>
                          </div>
                          {settingsToggles.map(renderFeatureCard)}
                        </div>
                      </section>
                    )}
                    {settingsTab === 'display' && (
                      <section className="wm-section">
                        <header className="wm-section__header">
                          <div>
                            <h2>Display</h2>
                            <p>Adjust the overall UI scale.</p>
                          </div>
                        </header>
                        <div className="wm-card wm-card--wide">
                          <div>
                            <h3>App Scale</h3>
                            <p>Make the interface more compact or spacious.</p>
                          </div>
                          <div className="wm-slider">
                            <input
                              type="range"
                              min="0.8"
                              max="1.4"
                              step="0.05"
                              value={appScale}
                              onChange={(event) =>
                                setAppScale(
                                  clampAppScale(Number(event.target.value))
                                )
                              }
                            />
                            <div className="wm-slider__value">
                              {Math.round(appScale * 100)}%
                            </div>
                            <div className="wm-slider__actions">
                              <button
                                className="btn btn--ghost btn--small"
                                onClick={() => setAppScale(1)}
                                type="button"
                              >
                                Reset
                              </button>
                            </div>
                          </div>
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App