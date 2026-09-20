"""
GridPoint Data Schemas & Contracts
Aligned with schema.md specification.
"""
from typing import List, Optional, Literal, Any, Dict
from pydantic import BaseModel, Field, field_validator, model_validator


class Neighborhood(BaseModel):
    """Represents a demand node / neighborhood."""
    neighborhood_id: str = Field(..., min_length=1, description="Stable unique identifier (e.g. N001)")
    name: Optional[str] = Field(None, max_length=100, description="Human readable label")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="WGS84 latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="WGS84 longitude")
    daily_orders: int = Field(..., ge=0, description="Daily order volume (weight w_i)")
    zone: Optional[str] = Field(None, description="Optional grouping zone")

    @model_validator(mode="after")
    def set_default_name(self):
        if not self.name or str(self.name).strip() == "":
            self.name = self.neighborhood_id
        return self


class Warehouse(BaseModel):
    """Represents a warehouse facility location."""
    warehouse_id: str = Field(..., description="Warehouse identifier (e.g. W1)")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    capacity: Optional[int] = Field(None, gt=0, description="Max orders servable (C_max)")
    radius_km: Optional[float] = Field(None, gt=0, description="Max service radius (R_max)")
    infra_cost: Optional[float] = Field(0.0, ge=0.0, description="Fixed infrastructure cost")
    assigned_orders: Optional[int] = Field(0, ge=0, description="Sum of daily orders assigned")
    utilization_pct: Optional[float] = Field(0.0, ge=0.0, le=100.0, description="Percentage of capacity used")


class VehicleType(BaseModel):
    """Vehicle fleet specification for bonus cost modeling."""
    vehicle_type: str = Field(..., description="e.g. bike, van, truck")
    capacity: int = Field(..., gt=0, description="Orders per trip")
    cost_per_km: float = Field(..., ge=0.0, description="Operating cost per km (excl. fuel)")
    fuel_type: Optional[str] = Field("petrol", description="petrol/diesel/cng/autogas/electric")
    avg_speed_kmph: Optional[float] = Field(30.0, gt=0.0)
    mileage_kmpl: Optional[float] = Field(None, gt=0.0, description="Fuel economy; fuel burn = live price / mileage per km")


class OptimizationConfig(BaseModel):
    """Configuration parameters for warehouse placement and assignment."""
    K: int = Field(2, ge=1, le=10, description="Number of warehouses to place")
    distance_metric: Literal["haversine", "euclidean", "manhattan", "road"] = Field("haversine")
    capacity_enabled: bool = Field(False)
    C_max: Optional[int] = Field(None, gt=0)
    radius_enabled: bool = Field(False)
    R_max_km: Optional[float] = Field(None, gt=0)
    cost_per_km: float = Field(1.0, ge=0.0)
    fuel_cost_per_km: float = Field(0.0, ge=0.0)
    infra_cost_per_warehouse: float = Field(0.0, ge=0.0)
    traffic_factor: float = Field(0.0, ge=0.0)
    use_live_fuel: bool = Field(False, description="Use live RapidAPI fuel prices for fuel burn")
    use_live_traffic: bool = Field(False, description="Use live TomTom corridor speeds for congestion")
    traffic_hour: Optional[int] = Field(None, ge=0, le=23, description="Hour-of-day for traffic history (default: now)")
    fuel_state: str = Field("Karnataka", description="Indian state for live fuel rates")
    fuel_city: Optional[str] = Field(None, description="City for live fuel rates (default: first city)")
    vehicle_fleet: List[VehicleType] = Field(default_factory=list)
    use_live_traffic_for_routing: bool = Field(False, description="Optimize matrices + assignment on current corridor traffic (#5-opt)")
    traffic_aware_reroute: bool = Field(False, description="Re-evaluate assignment as corridors change (#9)")
    simulation_mode: Literal["off", "realtime"] = Field("off", description="Live fuel/traffic/demand loop + congestion spillover (#12, #13)")
    simulation_congestion_threshold: float = Field(0.5, ge=0.0, description="Delay ratio that triggers spillover")
    simulation_hysteresis: float = Field(0.15, ge=0.0, description="Recovery gap below threshold to end a spill")
    simulation_cooldown_ticks: int = Field(2, ge=0, description="Ticks to wait before re-spilling a cleared warehouse")
    random_seed: int = Field(42)
    baseline_mode: Literal["centroid", "mean", "single_center", "custom"] = Field("centroid")
    custom_baseline_warehouses: Optional[List[Warehouse]] = Field(None)


class Assignment(BaseModel):
    """Neighborhood to warehouse assignment output."""
    neighborhood_id: str
    warehouse_id: str
    distance_km: float
    weighted_distance: float
    cost: float
    fuel_cost: float = 0.0
    within_radius: bool = True
    is_feasible: bool = True
    congestion_pct: Optional[float] = Field(None, ge=0.0, description="Corridor congestion applied (delay ratio)")
    travel_time_min: Optional[float] = Field(None, ge=0.0, description="Road travel time when distance_metric=road")


class SyntheticGenerationConfig(BaseModel):
    """Configuration for synthetic neighborhood dataset generation."""
    N: int = Field(50, ge=1, le=5000, description="Number of neighborhoods")
    lat_center: float = Field(17.385044, ge=-90.0, le=90.0, description="Center latitude (default: Hyderabad)")
    lon_center: float = Field(78.486671, ge=-180.0, le=180.0, description="Center longitude")
    spread_km: float = Field(20.0, gt=0.0, le=500.0, description="Spread radius in km")
    distribution: Literal["clustered", "uniform", "gaussian"] = Field("clustered")
    num_clusters: int = Field(3, ge=1, le=10)
    orders_min: int = Field(10, ge=0)
    orders_max: int = Field(200, ge=1)
    seed: int = Field(42)

    @model_validator(mode="after")
    def validate_orders_range(self):
        if self.orders_min > self.orders_max:
            raise ValueError("orders_min cannot be greater than orders_max")
        return self


class ValidationErrorItem(BaseModel):
    """Structured validation error."""
    row: Optional[int] = None
    field: str
    value: Any = None
    error: str
    code: str


class ValidationResult(BaseModel):
    """Aggregated validation response."""
    valid: bool
    errors: List[ValidationErrorItem] = Field(default_factory=list)
    warnings: List[ValidationErrorItem] = Field(default_factory=list)
    total_rows: int = 0
    valid_rows: int = 0


class WarehouseMetric(BaseModel):
    """Per-warehouse load and utilization metric."""
    warehouse_id: str
    assigned_orders: int = 0
    utilization_pct: Optional[float] = None
    avg_distance_km: float = 0.0
    neighborhood_count: int = 0


class Metrics(BaseModel):
    """Network delivery performance metrics (schema.md §2.6)."""
    total_unweighted_distance_km: float = 0.0
    total_weighted_distance_km_orders: float = 0.0
    total_cost: float = 0.0
    total_fuel_cost: float = 0.0
    fuel_live: bool = False
    avg_congestion_pct: float = 0.0
    avg_distance_per_order_km: float = 0.0
    avg_weighted_distance_km: float = 0.0
    warehouses: List[WarehouseMetric] = Field(default_factory=list)
    infeasible_assignments: int = 0
    feasibility_ratio: float = 1.0


class ComparisonDelta(BaseModel):
    """Delta metrics comparing baseline layout vs optimized layout (schema.md §2.7)."""
    distance_saved_km: float = 0.0
    weighted_distance_saved: float = 0.0
    cost_saved: float = 0.0
    pct_distance_saved: float = 0.0
    pct_cost_saved: float = 0.0


class LayoutEvaluation(BaseModel):
    """Metrics and warehouses for a given layout (baseline or optimized)."""
    metrics: Metrics
    warehouses: List[Warehouse]
    assignments: List[Assignment] = Field(default_factory=list)


class ComparisonResult(BaseModel):
    """Comparative evaluation result."""
    baseline: LayoutEvaluation
    optimized: LayoutEvaluation
    delta: ComparisonDelta


class OptimizationResult(BaseModel):
    """Complete output of optimization engine (schema.md §3.3)."""
    config: OptimizationConfig
    warehouses: List[Warehouse]
    assignments: List[Assignment]
    metrics: Metrics
    comparison: Optional[ComparisonResult] = None
    is_feasible: bool = True
    infeasibility_reason: Optional[str] = None
    fuel_note: Optional[str] = None
    traffic_note: Optional[str] = None
    routing_note: Optional[str] = None


class SpilloverEvent(BaseModel):
    """One congestion spillover start/end entry (schema.md §2.9, Phase F #13)."""
    tick: int = 0
    warehouse_id: str
    congestion_pct: float = 0.0
    moved_neighborhood_ids: List[str] = Field(default_factory=list)
    kind: Literal["spill_start", "spill_end"] = "spill_start"
    reason: str = ""


class ActiveSpill(BaseModel):
    """In-progress spill state carried between ticks (server is stateless)."""
    warehouse_id: str
    since_tick: int = 0
    last_cleared_tick: Optional[int] = None
    moved_neighborhood_ids: List[str] = Field(default_factory=list)
    original_warehouse: Dict[str, str] = Field(default_factory=dict)


class SimulationTickResult(BaseModel):
    """Response of POST /api/simulation/tick (Phase F #13, Phase I #6 extends §1.4)."""
    tick: int = 0
    simulation_mode: Literal["off", "realtime"] = "realtime"
    neighborhoods: List[Neighborhood] = Field(default_factory=list)
    assignments: List[Assignment] = Field(default_factory=list)
    metrics: Optional[Metrics] = None
    congestion_by_warehouse: Dict[str, float] = Field(default_factory=dict)
    congestion_live: Dict[str, bool] = Field(default_factory=dict)
    events: List[SpilloverEvent] = Field(default_factory=list)
    active_spills: Dict[str, ActiveSpill] = Field(default_factory=dict)
    demand_note: str = ""
    traffic_note: Optional[str] = None
    fuel_note: Optional[str] = None
    # Phase I additive-only (§1.4): visible order moves, capacity breathing,
    # fuel/traffic snapshot per tick. All optional so old clients keep working.
    order_moves: List[Dict[str, Any]] = Field(default_factory=list)
    capacity_updates: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    fuel_snapshot: Dict[str, Any] = Field(default_factory=dict)
    zone_intensities: Dict[str, float] = Field(default_factory=dict)


class OverviewAggregate(BaseModel):
    """Single rollup the Overview tab renders (schema.md §2.9, Phase F #14)."""
    vehicle_count: int = 0
    vehicle_mix: Dict[str, int] = Field(default_factory=dict)
    fuel_price: Dict[str, Any] = Field(default_factory=dict)
    infra_price: Dict[str, float] = Field(default_factory=dict)
    warehouse_count: int = 0
    utilization: List[Optional[float]] = Field(default_factory=list)
    order_totals: Dict[str, int] = Field(default_factory=dict)
    distance_cost: Dict[str, Any] = Field(default_factory=dict)
    alerts: List[str] = Field(default_factory=list)

