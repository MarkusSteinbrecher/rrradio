import SwiftUI

struct StationFilterView: View {
    let stations: [Station]
    @Binding var selectedCountry: String?
    @Binding var selectedTag: String?
    @Environment(\.dismiss) private var dismiss

    private var countries: [String] { availableCountries(from: stations) }
    private var tags: [Genre] { availableGenres(from: stations) }

    var body: some View {
        NavigationStack {
            List {
                if selectedCountry != nil || selectedTag != nil {
                    Section {
                        Button("Clear filters") {
                            selectedCountry = nil
                            selectedTag = nil
                        }
                    }
                }

                Section("Country") {
                    filterRow("All countries", selected: selectedCountry == nil) {
                        selectedCountry = nil
                    }
                    ForEach(countries, id: \.self) { code in
                        filterRow("\(countryDisplayName(code)) (\(code))", selected: selectedCountry == code) {
                            selectedCountry = code
                        }
                    }
                }

                Section("Tag") {
                    filterRow("All tags", selected: selectedTag == nil) {
                        selectedTag = nil
                    }
                    ForEach(tags) { tag in
                        filterRow(tag.label, selected: selectedTag == tag.id) {
                            selectedTag = tag.id
                        }
                    }
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func filterRow(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            action()
        } label: {
            HStack {
                Text(title)
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.tint)
                }
            }
        }
        .foregroundStyle(.primary)
    }
}
