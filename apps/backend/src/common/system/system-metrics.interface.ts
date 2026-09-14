export interface CpuMetrics {
  /** CPU usage of the current Node.js process as percentage (0-100% per core) */
  processPercent: number;
  /** Normalized CPU usage across all system cores (0-100%) */
  normalizedPercent: number;
  /** Total number of CPU cores */
  cores: number;
  /** OS load average for 1, 5, and 15 minutes */
  loadAvg: [number, number, number];
}

export interface MemoryMetrics {
  /** V8 heap memory currently used in MB */
  heapUsedMb: number;
  /** Total V8 heap memory allocated in MB */
  heapTotalMb: number;
  /** Resident Set Size (total memory allocated for process) in MB */
  rssMb: number;
  /** Memory used by C++ bindings bound to JavaScript in MB */
  externalMb: number;
  /** Total physical system memory in GB */
  systemTotalGb: number;
  /** Free physical system memory in GB */
  systemFreeGb: number;
  /** Used physical system memory in GB */
  systemUsedGb: number;
  /** Percentage of physical system memory used (0-100%) */
  systemUsedPercent: number;
}

export interface DatabaseMetrics {
  /** Connection state to PostgreSQL */
  status: 'connected' | 'disconnected';
  /** Total client connections currently open to PostgreSQL for this database */
  totalConnections: number | null;
  /** Connections currently executing an active query */
  activeConnections: number | null;
  /** Connections currently idle in pool */
  idleConnections: number | null;
  /** Connections currently idle within an open transaction */
  idleInTransactionConnections: number | null;
  /** Number of distinct client IP addresses / instances connected to the database */
  distinctClientIps: number | null;
  /** Maximum connection limit configured on PostgreSQL (max_connections) */
  maxConnections: number | null;
  /** Optional error message if database is unreachable or query failed */
  error?: string;
}

export interface SystemMetrics {
  /** ISO timestamp of the metric collection */
  timestamp: string;
  /** Process uptime in seconds */
  uptimeSeconds: number;
  /** CPU metrics */
  cpu: CpuMetrics;
  /** Memory metrics */
  memory: MemoryMetrics;
  /** Database connection metrics */
  database: DatabaseMetrics;
}
