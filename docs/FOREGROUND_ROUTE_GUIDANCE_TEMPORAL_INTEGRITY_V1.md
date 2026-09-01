# Foreground Route Guidance Temporal Integrity V1

## Scope

This contract applies to `RouteLocationSample` values before they can change
foreground Route Guidance state. It does not add background location,
rerouting, recording, or navigation guarantees.

## Core Location semantics

`CLLocation.timestamp` represents when Core Location determined the fix, not
when the delegate callback delivered it. Core Location documents
`didUpdateLocations` batches as chronological, but a newly started location
manager can still surface an older cached fix and separate callbacks must not
be assumed to be strictly ordered.

Route Guidance therefore compares every sample timestamp with the injected
`RouteGuidanceClock` at receipt and with the last accepted fix.

## Bounded acceptance policy

- Maximum age: **15 seconds**, inclusive. This permits a recent initial fix for
  quick foreground orientation while excluding a cached position old enough to
  misstate trail progress.
- Maximum future skew: **5 seconds**, inclusive. Core Location and `Date` use
  wall-clock timestamps; this small allowance covers bounded clock
  synchronization and rounding without admitting materially future data.
- Ordering: timestamps must be **strictly increasing** within an uninterrupted
  guidance session. Duplicate, equal, and reversed timestamps are rejected.
- Validity: non-finite sample or receipt timestamps are rejected.

The exact boundary is accepted. Any value beyond a boundary is rejected.

## State isolation

The temporal gate runs before all navigation-visible mutations. A rejected
sample cannot change:

- the latest displayed location or map recenter signal;
- progress, remaining distance, or remaining time;
- the current routing instruction;
- off-route entry or recovery counters;
- completion confirmations or phase;
- the last-fresh-update marker or delayed-location state.

A rejection also leaves the accepted-timestamp watermark unchanged so a later
valid sample is evaluated against the last valid fix, not against bad input.

## Lifecycle

- A new start or retry begins with a cleared temporal gate and staleness marker.
- User pause and foreground/background pause preserve the last accepted
  timestamp. Resume restarts the freshness timer at resume time, while replayed
  equal or older fixes remain rejected.
- End, completion, location failure, permission block, and view shutdown clear
  the temporal gate and staleness marker.
- A new `RouteGuidanceModel` always begins with empty temporal state.

When the user returns from Settings after a recoverable permission block
(denied, reduced accuracy, or disabled Location Services), guidance re-checks
authorization. Device/account restrictions remain non-recoverable in-app and
continue to direct the user back to route planning.

## Apple references

- [`CLLocation.timestamp`](https://developer.apple.com/documentation/corelocation/cllocation/timestamp)
  is the time at which the location was determined.
- [`CLLocationManagerDelegate`](https://developer.apple.com/documentation/corelocation/cllocationmanagerdelegate)
  warns that a newly started service may immediately deliver a cached value and
  recommends checking received timestamps before use.
- [`locationManager(_:didUpdateLocations:)`](https://developer.apple.com/documentation/corelocation/cllocationmanagerdelegate/locationmanager%28_%3Adidupdatelocations%3A%29)
  guarantees chronological order within a delivered batch, with the newest
  entry last; this contract still enforces monotonicity across callbacks.
