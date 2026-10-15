# The machine block

What the machine was doing at a moment, in one small block, so a slow or flaky run can be explained afterwards. `hq machine` prints it; `hq run-info` puts it on the run line; `hq slot` logs it when a run takes the slot and again when it gives it back, with the paging rate over the run. A reading whose command fails is `null`, and nothing here throws: a run never fails for want of a reading.

```json
{
  "load1": 1.8, "load5": 2.08, "cores": 12,
  "swap": { "usedMB": 4038, "totalMB": 5120 },
  "memFreePct": 50, "pressure": "normal",
  "paged": { "swapIn": 5597409, "swapOut": 5838199, "compressed": 272651412, "decompressed": 259119687 },
  "therm": { "thermal": 0, "performance": 0, "speedLimit": null },
  "power": { "source": "ac", "percent": 100, "lowPower": false },
  "top": [{ "cpu": 41, "name": "iTerm2" }, { "cpu": 21.3, "name": "claude" }, { "cpu": 12.1, "name": "Electron Helper (Renderer)" }]
}
```

| Field | Meaning |
| --- | --- |
| `load1`, `load5` | the load average over one and five minutes |
| `cores` | how many the system offers |
| `swap` | swap in use and its size, in megabytes |
| `memFreePct` | free memory as a share |
| `pressure` | `normal`, `warn` or `critical`, the system's own word; a run under `warn` is a starved run |
| `paged` | swap and compressor traffic since boot, in megabytes; the difference between two blocks is the paging over a run |
| `therm` | thermal and performance pressure and the CPU speed limit, where the system reports them |
| `power` | mains or battery, the charge, and whether low-power mode is on |
| `top` | the three busiest programs by CPU |

The block is macOS-shaped today; on another system the readings it cannot take are `null` and the rest stand. A reader keys on the field names and takes a missing field as unknown, never as zero.
