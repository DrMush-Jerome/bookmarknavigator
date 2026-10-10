#import <Cocoa/Cocoa.h>
#import <SafariServices/SafariServices.h>
#import <ApplicationServices/ApplicationServices.h>
#import "SyncCoordinator.h"
#import "SafariAutomation.h"

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSTextField *status;
@property NSTextField *syncStatus;
@property HubSyncCoordinator *sync;
@property NSButton *syncToggle;
@property NSStackView *setupPage;
@property NSStackView *syncPage;
@property BOOL syncStarted;
@end

@implementation AppDelegate
- (NSString *)extensionIdentifier {
    return [[[NSBundle mainBundle] bundleIdentifier] stringByAppendingString:@".Extension"];
}
- (NSTextField *)label:(NSString *)text size:(CGFloat)size {
    NSTextField *label = [NSTextField wrappingLabelWithString:text];
    label.font = [NSFont systemFontOfSize:size];
    label.alignment = NSTextAlignmentCenter;
    label.preferredMaxLayoutWidth = 548;
    [label.widthAnchor constraintEqualToConstant:548].active = YES;
    return label;
}
- (void)addStep:(NSString *)title detail:(NSString *)detail to:(NSStackView *)stack {
    NSTextField *heading = [self label:title size:17];
    heading.alignment = NSTextAlignmentLeft;
    heading.font = [NSFont systemFontOfSize:17 weight:NSFontWeightSemibold];
    [stack addArrangedSubview:heading];
    NSTextField *copy = [self label:detail size:13]; copy.alignment = NSTextAlignmentLeft;
    copy.textColor = NSColor.secondaryLabelColor; [stack addArrangedSubview:copy];
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 620, 660)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"书签导航台 · Safari";
    [self.window center];
    NSStackView *stack = [[NSStackView alloc] init];
    stack.orientation = NSUserInterfaceLayoutOrientationVertical;
    stack.spacing = 12;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self.window.contentView addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
        [stack.leadingAnchor constraintEqualToAnchor:self.window.contentView.leadingAnchor constant:36],
        [stack.trailingAnchor constraintEqualToAnchor:self.window.contentView.trailingAnchor constant:-36],
        [stack.centerYAnchor constraintEqualToAnchor:self.window.contentView.centerYAnchor]
    ]];
    NSImageView *icon = [NSImageView imageViewWithImage:[NSImage imageNamed:NSImageNameApplicationIcon]];
    [icon.widthAnchor constraintEqualToConstant:48].active = YES;
    [icon.heightAnchor constraintEqualToConstant:48].active = YES;
    [stack addArrangedSubview:icon];
    [stack addArrangedSubview:[self label:@"书签导航台" size:26]];
    NSString *version = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
    NSString *mode = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"HubBuildMode"];
    [stack addArrangedSubview:[self label:[NSString stringWithFormat:@"版本 %@ · %@", version, mode] size:13]];
    NSSegmentedControl *pages = [NSSegmentedControl segmentedControlWithLabels:@[@"安装与启用", @"书签同步（可选）"]
        trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(selectPage:)];
    pages.selectedSegment = 0; [stack addArrangedSubview:pages];
    self.setupPage = [[NSStackView alloc] init];
    self.setupPage.orientation = NSUserInterfaceLayoutOrientationVertical; self.setupPage.spacing = 10;
    [stack addArrangedSubview:self.setupPage];
    BOOL local = [mode isEqualToString:@"本地测试版"];
    if (local) {
        [self addStep:@"1  允许未签名扩展" detail:@"Safari > 设置 > 高级：显示网页开发者功能（首次设置）。\n在“开发者”（Safari 16 在“开发”菜单）中允许未签名扩展，按提示验证。" to:self.setupPage];
    }
    [self addStep:local ? @"2  启用书签导航台" : @"1  启用书签导航台"
        detail:@"点击下方按钮，在 Safari 的“扩展”列表中勾选“书签导航台”。" to:self.setupPage];
    [self addStep:local ? @"3  设为新标签页" : @"2  设为新标签页"
        detail:@"Safari > 设置 > 通用：将“新建标签页时打开”设为“书签导航台”。\n新建标签页后，在导航台的“设置 > 本地书签”导入书签 HTML。" to:self.setupPage];
    NSButton *button = [NSButton buttonWithTitle:@"打开 Safari 扩展设置" target:self action:@selector(openPreferences:)];
    button.bezelStyle = NSBezelStyleRounded;
    [self.setupPage addArrangedSubview:button];
    self.status = [self label:@"正在检查扩展状态…" size:12];
    [self.setupPage addArrangedSubview:self.status];
    if (local) {
        NSTextField *notice = [self label:@"完全退出 Safari 后，此允许选项会重置。下次打开 Safari 时需重新勾选；安装包无法永久保留这个设置。" size:12];
        notice.textColor = NSColor.secondaryLabelColor; [self.setupPage addArrangedSubview:notice];
    }
    self.syncPage = [[NSStackView alloc] init];
    self.syncPage.orientation = NSUserInterfaceLayoutOrientationVertical; self.syncPage.spacing = 14;
    self.syncPage.hidden = YES; [stack addArrangedSubview:self.syncPage];
    [self.syncPage addArrangedSubview:[self label:@"Safari 自动同步 · 实验功能" size:18]];
    [self.syncPage addArrangedSubview:[self label:@"需要 Safari 26、辅助功能及本产品的数据容器权限。助手需保持运行，Safari 在前台时发起仅书签导出。每次导出可能需要系统密码验证；删除会修改 Safari 原书签，并再次确认。暂不支持多个用户场景、编辑写回、移动或自动还原。" size:13]];
    self.syncToggle = [NSButton checkboxWithTitle:@"开启 Safari 自动导出同步" target:self action:@selector(toggleSync:)];
    [self.syncPage addArrangedSubview:self.syncToggle];
    NSStackView *actions = [[NSStackView alloc] init]; actions.spacing = 12;
    [actions addArrangedSubview:[NSButton buttonWithTitle:@"授权辅助功能" target:self action:@selector(authorizeAccessibility:)]];
    [actions addArrangedSubview:[NSButton buttonWithTitle:@"立即同步" target:self action:@selector(syncNow:)]];
    [actions addArrangedSubview:[NSButton buttonWithTitle:@"重新连接" target:self action:@selector(reconnect:)]];
    [self.syncPage addArrangedSubview:actions];
    self.syncStatus = [self label:@"打开此面板后检查同步助手；普通导入无需授权辅助功能。" size:12];
    [self.syncPage addArrangedSubview:self.syncStatus];
    self.sync = [[HubSyncCoordinator alloc] init];
    __weak AppDelegate *weakSelf = self;
    self.sync.onStatus = ^(NSString *text) {
        weakSelf.syncStatus.stringValue = text;
        weakSelf.syncToggle.state = weakSelf.sync.enabled ? NSControlStateValueOn : NSControlStateValueOff;
        weakSelf.syncToggle.enabled = weakSelf.sync.ready;
        if (weakSelf.syncToggle.enabled && [NSUserDefaults.standardUserDefaults boolForKey:@"HubAutoSyncEnabled"] != weakSelf.sync.enabled)
            [NSUserDefaults.standardUserDefaults setBool:weakSelf.sync.enabled forKey:@"HubAutoSyncEnabled"];
    };
    NSStackView *footer = [[NSStackView alloc] init]; footer.spacing = 16;
    [footer addArrangedSubview:[NSButton buttonWithTitle:@"重新检查" target:self action:@selector(checkSetup:)]];
    [footer addArrangedSubview:[NSButton buttonWithTitle:@"安装指南" target:self action:@selector(openGuide:)]];
    [stack addArrangedSubview:footer];
    NSString *location = NSBundle.mainBundle.bundlePath;
    if (![location hasPrefix:@"/Applications/"] && ![location hasPrefix:[NSHomeDirectory() stringByAppendingPathComponent:@"Applications/"]])
        [stack addArrangedSubview:[self label:@"请先把 App 放入“应用程序”，再从那里打开；不要直接从安装磁盘运行。" size:12]];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    if ([NSUserDefaults.standardUserDefaults boolForKey:@"HubAutoSyncEnabled"]) [self startSync];
    [self registerExtension];
}
- (void)startSync {
    if (self.syncStarted) return;
    self.syncStarted = YES; self.syncToggle.enabled = NO;
    [self.sync start];
}
- (void)selectPage:(NSSegmentedControl *)sender {
    self.setupPage.hidden = sender.selectedSegment != 0;
    self.syncPage.hidden = sender.selectedSegment == 0;
    if (sender.selectedSegment == 1) [self startSync];
}
- (void)checkSetup:(id)sender { [self refreshStatus]; }
- (void)openGuide:(id)sender {
    NSURL *guide = [NSBundle.mainBundle URLForResource:@"安装指南" withExtension:@"html"];
    if (guide) [NSWorkspace.sharedWorkspace openURL:guide];
}
- (void)registerExtension {
    // 单独注册当前 App 内的扩展，避免 Launch Services 与 Safari 缓存不同步。
    NSURL *extension = [NSBundle.mainBundle.builtInPlugInsURL
        URLByAppendingPathComponent:@"bookmarknavigator Extension.appex" isDirectory:YES];
    if (!extension || ![NSFileManager.defaultManager fileExistsAtPath:extension.path]) {
        self.status.stringValue = @"App 内的 Safari 扩展缺失，请重新安装完整安装包。"; return;
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSTask *task = [[NSTask alloc] init];
        task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/pluginkit"];
        task.arguments = @[@"-a", extension.path];
        task.standardOutput = NSFileHandle.fileHandleWithNullDevice;
        task.standardError = NSFileHandle.fileHandleWithNullDevice;
        NSError *error = nil;
        BOOL launched = [task launchAndReturnError:&error];
        if (launched) [task waitUntilExit];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!launched || task.terminationStatus != 0)
                self.status.stringValue = @"扩展注册未完成。请确认 App 已放入应用程序，再重新打开。";
            else [self refreshStatus];
        });
    });
}
- (void)refreshStatus {
    [SFSafariExtensionManager getStateOfSafariExtensionWithIdentifier:[self extensionIdentifier]
        completionHandler:^(SFSafariExtensionState *state, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            self.status.stringValue = error ? @"请打开 Safari 扩展设置完成启用。" :
                (state.enabled ? @"Safari 已勾选启用 · 请打开新标签页确认" : @"扩展尚未启用 · 按上方步骤完成设置");
        });
    }];
}
- (void)applicationDidBecomeActive:(NSNotification *)notification { if (self.status) [self refreshStatus]; }
- (void)openPreferences:(id)sender {
    [SFSafariApplication showPreferencesForExtensionWithIdentifier:[self extensionIdentifier]
        completionHandler:^(NSError *error) {
        if (error) dispatch_async(dispatch_get_main_queue(), ^{
            self.status.stringValue = @"请手动打开 Safari > 设置 > 扩展；测试版需允许未签名扩展。";
        });
    }];
}
- (void)authorizeAccessibility:(id)sender {
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{(__bridge NSString *)kAXTrustedCheckOptionPrompt:@YES});
    self.syncStatus.stringValue = @"请在系统设置 > 隐私与安全性 > 辅助功能中授权此 App，然后切回 Safari。";
}
- (void)activateSafari {
    HubActivateSafari();
}
- (void)toggleSync:(NSButton *)sender {
    if (sender.state == NSControlStateValueOn && !AXIsProcessTrusted()) {
        sender.state = NSControlStateValueOff; self.syncStatus.stringValue = @"请先点击“授权辅助功能”，完成系统授权后再开启同步。"; return;
    }
    if (sender.state == NSControlStateValueOn) [self activateSafari];
    [self.sync setEnabled:sender.state == NSControlStateValueOn];
    sender.state = self.sync.enabled ? NSControlStateValueOn : NSControlStateValueOff;
}
- (void)syncNow:(id)sender {
    if (!self.sync.enabled) { self.syncStatus.stringValue = @"请先开启自动导出同步。"; return; }
    [self activateSafari]; [self.sync syncNow];
}
- (void)showHelper:(id)sender { [self.window makeKeyAndOrderFront:nil]; }
- (void)reconnect:(id)sender { if (!self.sync.enabled) [self.sync start]; }
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    [self showHelper:nil]; return YES;
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return !self.sync.enabled; }
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        NSMenu *menu = [[NSMenu alloc] init];
        NSMenuItem *item = [[NSMenuItem alloc] init]; [menu addItem:item];
        NSMenu *appMenu = [[NSMenu alloc] init];
        [appMenu addItemWithTitle:@"显示书签导航台助手" action:@selector(showHelper:) keyEquivalent:@"0"];
        [appMenu addItemWithTitle:@"退出书签导航台" action:@selector(terminate:) keyEquivalent:@"q"];
        item.submenu = appMenu; app.mainMenu = menu;
        [app run];
    }
    return 0;
}
