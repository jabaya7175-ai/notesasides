import SwiftUI
import WebKit
import SafariServices

/// The Studio lives on the web; the app shows it full screen, keeps you signed in,
/// and opens anything outside the Studio (the public site, YouTube, articles) in Safari.
enum Studio {
    static let url = URL(string: "https://jabaya7175-ai.github.io/notesasides/studio/")!
    /// Pages inside the Studio stay in the app; everything else opens in Safari.
    static func isInside(_ u: URL) -> Bool {
        guard let host = u.host, host == url.host else { return false }
        return u.path.hasPrefix(url.path) || u.path.hasPrefix(url.path.replacingOccurrences(of: "studio/", with: "_astro/"))
    }
    static let ink = UIColor(red: 0.078, green: 0.110, blue: 0.145, alpha: 1)
}

@main
struct StudioApp: App {
    @StateObject private var web = WebModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(Studio.ink).ignoresSafeArea()
                WebView(model: web).ignoresSafeArea(.container, edges: .bottom)
                if web.failed { Offline { web.reload() } }
            }
            .preferredColorScheme(.dark)
            .onOpenURL { web.open($0) }
        }
        .onChange(of: phase) { _, p in if p == .active { web.reviveIfBlank() } }
    }
}

final class WebModel: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let view: WKWebView
    @Published var failed = false

    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()            // stays signed in between launches
        cfg.allowsInlineMediaPlayback = true          // YouTube pieces play on the board
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "NotesAsidesStudioApp/1.0"
        cfg.preferences.isElementFullscreenEnabled = true
        cfg.defaultWebpagePreferences.preferredContentMode = .desktop // the iPad gets the full Studio
        view = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        view.isOpaque = false
        view.backgroundColor = Studio.ink
        view.scrollView.backgroundColor = Studio.ink
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        view.allowsBackForwardNavigationGestures = false
        view.allowsLinkPreview = false
        view.navigationDelegate = self
        view.uiDelegate = self
        if #available(iOS 16.4, *) { view.isInspectable = true }
        view.load(URLRequest(url: Studio.url))
    }

    func reload() { failed = false; if view.url == nil { view.load(URLRequest(url: Studio.url)) } else { view.reload() } }
    /// iOS may drop a backgrounded web view's content; bring it back on return.
    func reviveIfBlank() { if view.url == nil || failed { reload() } }
    /// notesasides-studio://desk → the drafting board; any Studio https link → that page.
    func open(_ u: URL) {
        if u.scheme == "notesasides-studio" {
            let hash = "#/" + [u.host, u.path.isEmpty ? nil : String(u.path.dropFirst())].compactMap { $0 }.joined(separator: "/")
            view.load(URLRequest(url: URL(string: Studio.url.absoluteString + (hash == "#/" ? "" : hash))!))
        } else if Studio.isInside(u) { view.load(URLRequest(url: u)) }
    }

    private func openOutside(_ u: URL) {
        guard let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first else { return }
        var top = root; while let p = top.presentedViewController { top = p }
        if u.scheme == "http" || u.scheme == "https" {
            let sf = SFSafariViewController(url: u); sf.preferredControlTintColor = UIColor(red: 0.91, green: 0.89, blue: 0.82, alpha: 1)
            sf.preferredBarTintColor = Studio.ink; sf.dismissButtonStyle = .done
            top.present(sf, animated: true)
        } else { UIApplication.shared.open(u) }
    }

    // MARK: navigation
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = a.request.url else { return decisionHandler(.allow) }
        // Sub-frames (YouTube players, PDF workers) load normally.
        if a.targetFrame?.isMainFrame == false || u.scheme == "about" || u.scheme == "blob" || u.scheme == "data" { return decisionHandler(.allow) }
        // Supabase sign-in redirects and the Studio itself stay inside.
        if Studio.isInside(u) || u.host?.hasSuffix("supabase.co") == true { return decisionHandler(.allow) }
        decisionHandler(.cancel); openOutside(u)
    }
    /// target=_blank links ("View site", "Open on YouTube", "Open in a new window").
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { if Studio.isInside(u) { w.load(URLRequest(url: u)) } else { openOutside(u) } }
        return nil
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { failed = false }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { fail(e) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { fail(e) }
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { w.reload() }
    private func fail(_ e: Error) {
        let ns = e as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return } // frame load interrupted (we opened it in Safari)
        failed = true
    }

    // MARK: the Studio's confirm boxes are its own dialogs; these cover any plain alert()/confirm()
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
        present(UIAlertController(title: nil, message: m, preferredStyle: .alert), actions: [("OK", .default, completionHandler)], fallback: completionHandler)
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        present(UIAlertController(title: nil, message: m, preferredStyle: .alert), actions: [("Cancel", .cancel, { completionHandler(false) }), ("OK", .default, { completionHandler(true) })], fallback: { completionHandler(false) })
    }
    private func present(_ a: UIAlertController, actions: [(String, UIAlertAction.Style, () -> Void)], fallback: @escaping () -> Void) {
        actions.forEach { t, s, f in a.addAction(UIAlertAction(title: t, style: s) { _ in f() }) }
        guard let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first else { return fallback() }
        var top = root; while let p = top.presentedViewController { top = p }
        top.present(a, animated: true)
    }
}

struct WebView: UIViewRepresentable {
    let model: WebModel
    func makeUIView(context: Context) -> WKWebView { model.view }
    func updateUIView(_ v: WKWebView, context: Context) {}
}

struct Offline: View {
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Text("Notes & Asides.").font(.custom("Georgia", size: 30)).foregroundStyle(Color(red: 0.91, green: 0.89, blue: 0.82))
            Text("The Studio couldn’t be reached. Check your connection.").font(.custom("Georgia", size: 18)).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Try again", action: retry).buttonStyle(.borderedProminent).tint(Color(red: 0.76, green: 0.27, blue: 0.23)).padding(.top, 6)
        }
        .padding(40).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color(Studio.ink))
    }
}
