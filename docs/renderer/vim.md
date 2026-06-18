# Vim System

Vim applies to the **Reader** only. The **Control Room is mouse-driven** (see
[design.md](design.md)); zones are switched via header tabs or the `:` commands
below. The VimBar is hidden outside the Reader.

## Modes

| Mode | Enter via | Behavior |
|------|-----------|----------|
| **Normal** | Default / `Escape` | Keypresses trigger actions |
| **Command** | `:` | Typing into VimBar |

No insert mode — text inputs (VimBar) handle their own focus.

## Global Keybindings

### Universal

| Key | Action |
|-----|--------|
| `:` | Enter command mode |
| `Escape` | Close overlay / back / unwind to previous view |

## Commands (: prefix)

| Command | Action |
|---------|--------|
| `:Feed` | Navigate to Reader |
| `:ControlRoom` | Navigate to Control Room |
| `:q` | Close current overlay/dialog |

## List Navigation

Reused in any zone with a list. Every list in the app works the same.

| Key | Action |
|-----|--------|
| `j` | Cursor down |
| `k` | Cursor up |
| `G` | Jump to bottom |
| `gg` | Jump to top |
| `Enter` | Select / expand / open |

## Zone: Reader

### Feed View (default)

Full-width centered paper list.

| Key | Action |
|-----|--------|
| `j/k` | Navigate papers |
| `G/gg` | Jump to bottom/top |
| `Enter` | Open split view (feed list + paper detail) |
| `d` | Dismiss paper |
| `s` | Star / save paper |
| `c` | Calendar modal (pick feed date) |
| `p` | Profile modal |
| `t` | Threshold modal |
| `x` | Dismissed papers modal |

### Split View (after Enter)

Left panel: narrowed feed list. Right panel: paper detail.

| Key | Action |
|-----|--------|
| `j/k` | Navigate papers in left panel |
| `G/gg` | Jump to bottom/top |
| `Escape` | Back to feed view |

## Zone: Control Room

Mouse-driven — no vim keybindings. Steps, date picker, run button, feeds, and run
history are all click targets. See [design.md](design.md) for the layout.

`Escape` closes the calendar dropdown, then the feed detail — handled by the
ControlRoom component itself, not the vim system. App.tsx skips all key routing
while in the Control Room zone.

## Unwinding (Escape behavior — Reader)

In the Reader, Escape moves one step back:

1. Command mode → normal mode
2. Modal open → close modal
3. Split view → feed view
