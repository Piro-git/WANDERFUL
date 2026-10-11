import SwiftUI

struct RouteWeatherCard: View {
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let route: TrailRoute
    private let client: any RouteWeatherProviding
    @State private var selectedDate: Date
    @State private var hasDate: Bool
    @State private var forecast: RouteWeather?
    @State private var loading = false
    @State private var failed = false
    @State private var details = false
    @State private var requestID: UUID?

    init(route: TrailRoute, client: any RouteWeatherProviding = RouteWeatherClient(), initialForecast: RouteWeather? = nil) {
        self.route = route; self.client = client
        _forecast = State(initialValue: initialForecast)
        let date = PlanningEvidenceDate.parse(initialForecast?.plannedStartAt ?? route.localConditions?.visitTime)
        _selectedDate = State(initialValue: date ?? Date.now.addingTimeInterval(3600))
        _hasDate = State(initialValue: date != nil)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            VStack(alignment: .leading, spacing: 12) {
                Label(weatherText("Weather along your route"), systemImage: "cloud.sun")
                    .font(.headline)
                if let forecast, forecast.state == .available, forecast.isFresh(at: context.date) {
                    weatherSummary(forecast)
                } else {
                    Text(status(at: context.date)).font(.subheadline)
                        .accessibilityIdentifier("route.weather.status")
                }
                DisclosureGroup(weatherText("Time and forecast details"), isExpanded: $details) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(weatherText("Plan your layers and breaks with a forecast for points along this route."))
                            .font(.subheadline).foregroundStyle(.secondary)
                        DatePicker(weatherText("Planned start"), selection: $selectedDate, displayedComponents: [.date, .hourAndMinute])
                            .accessibilityIdentifier("route.weather.date")
                        Text(String(format: weatherText("Times shown in %@ (device time zone)."), TimeZone.current.identifier))
                            .font(.caption).foregroundStyle(.secondary)
                        Text(weatherText("The window uses the mapped route duration without breaks. Three samples cannot describe every trail section. Forecasts can change, especially in mountains; check official warnings before setting off."))
                            .font(.caption).foregroundStyle(.secondary)
                        if let forecast, forecast.state == .available, forecast.isFresh(at: context.date) {
                            ForEach(forecast.samples) { sample in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(weatherText(sample.fraction == 0 ? "Start" : sample.fraction == 1 ? "Finish" : sample.fraction == 0.33 ? "One third along the route" : sample.fraction == 0.67 ? "Two thirds along the route" : "Halfway along the route")).font(.subheadline.weight(.medium))
                                    Text(metrics([sample])).font(.subheadline)
                                    Text(String(format: weatherText("Forecast interval: %d h"), sample.intervalHours)).font(.caption)
                                    if let updated = PlanningEvidenceDate.parse(sample.sourceUpdatedAt),
                                       let retrieved = PlanningEvidenceDate.parse(sample.retrievedAt) {
                                        Text(String(format: weatherText("Model updated %@ · retrieved %@"), formatted(updated), formatted(retrieved)))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }.accessibilityElement(children: .combine)
                            }
                            Text(weatherText("Precipitation is the highest interval average, including rain or snow, not a peak intensity or a trip total. Wind is modelled near the ground, not gusts. Values are summarized across the trip window."))
                                .font(.caption).foregroundStyle(.secondary)
                            Link(weatherText("Data license · CC BY 4.0"), destination: URL(string: "https://creativecommons.org/licenses/by/4.0/")!)
                                .font(.caption)
                        }
                    }.padding(.top, 10)
                }
                Button {
                    if !hasDate { hasDate = true; details = true }
                    else { requestID = UUID() }
                } label: {
                    if loading { HStack { ProgressView(); Text(weatherText("Checking weather…")) } }
                    else { Text(weatherText(!hasDate ? "Choose trip time" : forecast == nil ? "Check route weather" : "Refresh weather")) }
                }
                .buttonStyle(.bordered).disabled(loading)
                .accessibilityIdentifier("route.weather.check")
            }
            .padding(18)
            .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .onChange(of: selectedDate) { _, _ in
            requestID = nil; forecast = nil; failed = false; hasDate = true
        }
        .task(id: requestID) {
            guard requestID != nil else { return }
            loading = true; failed = false; forecast = nil
            defer { loading = false }
            do {
                let value = try await client.forecast(route: route, start: selectedDate)
                try Task.checkCancellation()
                forecast = value
            } catch is CancellationError {} catch { if !Task.isCancelled { failed = true } }
        }
    }
    private func status(at now: Date) -> String {
        if loading { return weatherText("Checking three points along the route…") }
        if failed { return weatherText("Weather could not be loaded. Check your connection and try again; your route is unchanged.") }
        guard let forecast else { return weatherText(hasDate ? "Check the forecast for your planned start." : "Choose a start date and time in the details to see your route forecast.") }
        switch forecast.state {
        case .available: return weatherText("This forecast needs a fresh check.")
        case .dateRequired: return weatherText("Choose a start date and time in the details to see your route forecast.")
        case .outsideHorizon: return weatherText("This trip window is outside the available forecast. Choose a future start within about nine days and check again closer to departure.")
        case .durationUnsupported: return weatherText("Weather previews cover routes up to 24 hours. Check each day separately for a longer trip.")
        case .unavailable: return weatherText("Weather is currently unavailable for this route. Please try again later and consult a local forecast.")
        }
    }
    private func weatherSummary(_ value: RouteWeather) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let start = PlanningEvidenceDate.parse(value.plannedStartAt), let end = PlanningEvidenceDate.parse(value.windowEnd) {
                Text("\(formatted(start)) – \(formatted(end))").font(.subheadline.weight(.medium))
            }
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            layout {
                weatherMetric("Temperature", value: String(format: "%.0f–%.0f", locale: locale,
                    value.samples.map(\.temperatureMinC).min() ?? 0,
                    value.samples.map(\.temperatureMaxC).max() ?? 0), unit: "°C")
                weatherMetric("Rain / snow", value: String(format: weatherText("up to %.1f"), locale: locale,
                    value.samples.map(\.precipitationMaxMmPerHour).max() ?? 0), unit: weatherText("mm/h on average"),
                    accessibility: String(format: weatherText("Average precipitation up to %.1f millimetres per hour"), locale: locale,
                        value.samples.map(\.precipitationMaxMmPerHour).max() ?? 0))
                weatherMetric("Wind", value: String(format: "≤ %.0f", locale: locale,
                    value.samples.map(\.windMaxKmh).max() ?? 0), unit: "km/h")
            }
            .accessibilityIdentifier("route.weather.summary")
            Link(weatherText("Weather data: MET Norway"), destination: URL(string: "https://api.met.no/")!).font(.caption)
            if let updated = value.samples.compactMap({ PlanningEvidenceDate.parse($0.sourceUpdatedAt) }).min() {
                Text(String(format: weatherText("Data updated %@"), formatted(updated)))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func weatherMetric(_ title: String, value: String, unit: String, accessibility: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(weatherText(title)).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold))
            Text(unit).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibility ?? "\(weatherText(title)), \(value) \(unit)")
    }
    private func metrics(_ samples: [RouteWeather.Sample]) -> String {
        String(format: weatherText("%.0f–%.0f °C · precipitation up to %.1f mm/h · wind up to %.0f km/h"),
               locale: locale, samples.map(\.temperatureMinC).min() ?? 0, samples.map(\.temperatureMaxC).max() ?? 0,
               samples.map(\.precipitationMaxMmPerHour).max() ?? 0, samples.map(\.windMaxKmh).max() ?? 0)
    }
    private func weatherText(_ key: String) -> String {
        let language = locale.language.languageCode?.identifier ?? "en"
        let bundle = Bundle.main.path(forResource: language, ofType: "lproj").flatMap(Bundle.init(path:)) ?? .main
        return bundle.localizedString(forKey: key, value: key, table: "RouteWeather")
    }
    private func formatted(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(locale))
    }
}
