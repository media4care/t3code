import ExpoModulesCore
import UIKit

private final class WorkspaceTabBar: UITabBar {
  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    invalidateIntrinsicContentSize()
  }
}

final class T3SidebarTabBarView: ExpoView, UITabBarDelegate {
  let onSelectionChange = EventDispatcher()
  let onCompose = EventDispatcher()
  private let tabBar = WorkspaceTabBar()
  private let composeItem = UITabBarItem(title: nil, image: nil, tag: -1)
  private var itemsByTab: [String: UITabBarItem] = [:]
  var tabs = ["threads", "pullRequests", "gitExplorer", "insights", "usage", "qa", "settings"] {
    didSet { if tabs != oldValue { updateItems() } }
  }
  var selectedTab = "threads" { didSet { updateSelection() } }
  var selectedColor: UIColor = .systemBlue { didSet { tabBar.tintColor = selectedColor } }
  var showsCompose = false {
    didSet { if showsCompose != oldValue { updateItems() } }
  }
  var appearance = "light" {
    didSet { overrideUserInterfaceStyle = appearance == "dark" ? .dark : .light }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    tabBar.itemPositioning = .fill
    // iPad's regular bar uses a compressed inline row even with fill positioning.
    // This floating sidebar control needs the same full-size items as a phone bar.
    if #available(iOS 17.0, *) {
      tabBar.traitOverrides.horizontalSizeClass = .compact
    }
    tabBar.delegate = self
    tabBar.translatesAutoresizingMaskIntoConstraints = false
    addSubview(tabBar)
    NSLayoutConstraint.activate([
      tabBar.leadingAnchor.constraint(equalTo: leadingAnchor),
      tabBar.trailingAnchor.constraint(equalTo: trailingAnchor),
      tabBar.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
    // Keep compose inside the bar so UIKit owns its layout and touch target.
    composeItem.image = tabIcon(UIImage(systemName: "square.and.pencil"))
    composeItem.accessibilityLabel = "New thread"
    composeItem.accessibilityIdentifier = "workspace-compose"
    prepareItems()
    updateItems()
  }

  private func prepareItems() {
    let iconBundle = Bundle(for: Self.self).url(forResource: "T3NativeControlIcons", withExtension: "bundle").flatMap(Bundle.init(url:))
    let pullRequestIcon = UIImage(named: "pull-request", in: iconBundle, compatibleWith: nil)?.withRenderingMode(.alwaysTemplate)
    let labels = ["threads": "Chats", "pullRequests": "PRs", "gitExplorer": "Git Explorer", "usage": "Usage", "insights": "Insights", "qa": "QA", "settings": "Settings"]
    let symbols = ["threads": "text.bubble", "gitExplorer": "point.topleft.down.curvedto.point.bottomright.up", "usage": "chart.bar.xaxis", "insights": "lightbulb", "qa": "checkmark.seal", "settings": "gearshape"]
    for (tab, label) in labels {
      let icon = tab == "pullRequests" ? pullRequestIcon : UIImage(systemName: symbols[tab] ?? "circle")
      let item = UITabBarItem(title: nil, image: tabIcon(icon), tag: 0)
      item.accessibilityLabel = label
      item.accessibilityIdentifier = "workspace-tab-\(tab)"
      if tab == "threads" { item.selectedImage = tabIcon(UIImage(systemName: "text.bubble.fill")) }
      itemsByTab[tab] = item
    }
  }

  private func updateItems() {
    let navigationItems = tabs.enumerated().compactMap { index, tab -> UITabBarItem? in
      guard let item = itemsByTab[tab] else { return nil }
      item.tag = index
      return item
    }
    tabBar.items = (showsCompose ? [composeItem] : []) + navigationItems
    updateSelection()
  }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    return tabBar.hitTest(convert(point, to: tabBar), with: event)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateSelection()
  }

  // Symbols include unequal transparent padding, so centering their image boxes alone
  // leaves the pencil visibly below its neighbors. Align the rendered ink instead.
  private func tabIcon(_ image: UIImage?) -> UIImage? {
    guard let image else { return nil }
    let canvas = CGSize(width: 28, height: 28)
    let scale = min(24 / image.size.width, 24 / image.size.height)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let renderer = UIGraphicsImageRenderer(size: canvas)
    let raster = renderer.image { _ in
      image.draw(in: CGRect(x: (canvas.width - size.width) / 2, y: (canvas.height - size.height) / 2, width: size.width, height: size.height))
    }
    guard let cgImage = raster.cgImage else { return raster.withRenderingMode(.alwaysTemplate) }
    let width = cgImage.width
    let height = cgImage.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
      guard let context = CGContext(data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard rendered else { return raster.withRenderingMode(.alwaysTemplate) }
    var minX = width, minY = height, maxX = -1, maxY = -1
    for y in 0..<height {
      for x in 0..<width where pixels[(y * width + x) * 4 + 3] > 0 {
        minX = min(minX, x)
        minY = min(minY, y)
        maxX = max(maxX, x)
        maxY = max(maxY, y)
      }
    }
    guard maxX >= minX, maxY >= minY else { return raster.withRenderingMode(.alwaysTemplate) }
    let offset = CGPoint(
      x: CGFloat(width - minX - maxX - 1) / (2 * raster.scale),
      y: CGFloat(height - minY - maxY - 1) / (2 * raster.scale)
    )
    return renderer.image { _ in raster.draw(at: offset) }.withRenderingMode(.alwaysTemplate)
  }

  private func updateSelection() {
    guard let item = itemsByTab[selectedTab], tabBar.items?.contains(item) == true else { return }
    guard tabBar.selectedItem !== item else { return }
    tabBar.selectedItem = item
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    if item === composeItem {
      // Compose is an action; keep the current section selected when returning from a draft.
      updateSelection()
      onCompose()
      return
    }
    guard tabs.indices.contains(item.tag) else { return }
    onSelectionChange(["tab": tabs[item.tag]])
  }
}
