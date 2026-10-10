#import "SafariAutomation.h"
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>

static BOOL Fail(NSError **error, NSString *message) {
    if (error) *error = [NSError errorWithDomain:@"SafariAutomation" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];
    return NO;
}
static id Attr(AXUIElementRef element, CFStringRef key) {
    CFTypeRef result = NULL;
    if (!element || AXUIElementCopyAttributeValue(element, key, &result) != kAXErrorSuccess) return nil;
    return CFBridgingRelease(result);
}
static NSArray *Children(AXUIElementRef element) {
    id result = Attr(element, kAXChildrenAttribute); return [result isKindOfClass:NSArray.class] ? result : @[];
}
static AXUIElementRef Find(AXUIElementRef element, NSString *identifier, NSUInteger depth) {
    if (!element || depth > 16) return NULL;
    if ([Attr(element, kAXIdentifierAttribute) isEqual:identifier]) return (AXUIElementRef)CFRetain(element);
    NSString *role = Attr(element, kAXRoleAttribute);
    // 控件查找跳过网页内容与文件列表。
    if ([role isEqual:@"AXWebArea"] || (depth &&
        ([role isEqual:@"AXOutline"] || [role isEqual:@"AXBrowser"] ||
         [role isEqual:@"AXList"] || [role isEqual:@"AXTable"]))) return NULL;
    NSMutableArray *children = [NSMutableArray array];
    // 应用节点的子级同时包含菜单栏和窗口；窗口查找与菜单查找分开。
    if (![role isEqual:@"AXApplication"]) [children addObjectsFromArray:Children(element)];
    id sheets = Attr(element, CFSTR("AXSheets"));
    if ([sheets isKindOfClass:NSArray.class]) [children insertObjects:sheets atIndexes:
        [NSIndexSet indexSetWithIndexesInRange:NSMakeRange(0, [sheets count])]];
    if ([role isEqual:@"AXApplication"]) {
        id windows = Attr(element, kAXWindowsAttribute);
        if ([windows isKindOfClass:NSArray.class]) [children insertObjects:windows atIndexes:
            [NSIndexSet indexSetWithIndexesInRange:NSMakeRange(0, [windows count])]];
    }
    for (id child in children) {
        AXUIElementRef found = Find((__bridge AXUIElementRef)child, identifier, depth + 1);
        if (found) return found;
    }
    return NULL;
}
static AXUIElementRef App(void) {
    NSRunningApplication *safari = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.Safari"].firstObject;
    return safari ? AXUIElementCreateApplication(safari.processIdentifier) : NULL;
}
static BOOL SafariActive(void) {
    return [[[NSWorkspace sharedWorkspace] frontmostApplication].bundleIdentifier isEqual:@"com.apple.Safari"];
}
static BOOL SafariAuthenticationOpen(void) {
    // 只读取窗口身份，不读取密码字段。
    for (NSRunningApplication *agent in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.LocalAuthentication.UIAgent"]) {
        AXUIElementRef auth = AXUIElementCreateApplication(agent.processIdentifier);
        id windows = Attr(auth, kAXWindowsAttribute); BOOL found = NO;
        for (id window in ([windows isKindOfClass:NSArray.class] ? windows : @[])) {
            AXUIElementRef element = (__bridge AXUIElementRef)window;
            id title = Attr(element, kAXTitleAttribute);
            if ([Attr(element, kAXIdentifierAttribute) isEqual:@"com.apple.LocalAuthentication.PasscodeDialog"] &&
                [title isKindOfClass:NSString.class] && [title rangeOfString:@"Safari" options:NSCaseInsensitiveSearch].location != NSNotFound)
                found = YES;
        }
        CFRelease(auth); if (found) return YES;
    }
    return NO;
}
void HubActivateSafari(void) {
    NSRunningApplication *safari = [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.apple.Safari"].firstObject;
    if (!safari) return;
    if (@available(macOS 14.0, *)) {
        [NSApp yieldActivationToApplication:safari];
        [safari activateFromApplication:NSRunningApplication.currentApplication options:0];
    } else [safari activateWithOptions:NSApplicationActivateIgnoringOtherApps];
}
static BOOL Press(AXUIElementRef element) { return element && AXUIElementPerformAction(element, kAXPressAction) == kAXErrorSuccess; }
static void SendKey(AXUIElementRef app, CGKeyCode key, CGEventFlags flags) {
    pid_t pid; if (AXUIElementGetPid(app, &pid) != kAXErrorSuccess || !SafariActive()) return;
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
    NSArray *modifiers = @[@[@(kCGEventFlagMaskCommand), @(kVK_Command)],
        @[@(kCGEventFlagMaskShift), @(kVK_Shift)], @[@(kCGEventFlagMaskAlternate), @(kVK_Option)]];
    CGEventFlags held = 0;
    for (NSArray *modifier in modifiers) if (flags & [modifier[0] unsignedLongLongValue]) {
        held |= [modifier[0] unsignedLongLongValue];
        CGEventRef event = CGEventCreateKeyboardEvent(source, [modifier[1] unsignedShortValue], true);
        if (event) { CGEventSetFlags(event, held); if (SafariActive()) CGEventPost(kCGSessionEventTap, event); CFRelease(event); }
    }
    for (NSUInteger i = 0; i < 2; i++) {
        CGEventRef event = CGEventCreateKeyboardEvent(source, key, i == 0);
        if (event) { CGEventSetFlags(event, flags); if (i || SafariActive()) CGEventPost(kCGSessionEventTap, event); CFRelease(event); }
    }
    for (NSArray *modifier in modifiers.reverseObjectEnumerator) if (flags & [modifier[0] unsignedLongLongValue]) {
        held &= ~[modifier[0] unsignedLongLongValue];
        CGEventRef event = CGEventCreateKeyboardEvent(source, [modifier[1] unsignedShortValue], false);
        // 切换应用后仍需释放本次模拟的修饰键。
        if (event) { CGEventSetFlags(event, held); CGEventPost(kCGSessionEventTap, event); CFRelease(event); }
    }
    if (source) CFRelease(source);
}
static void Key(AXUIElementRef app, CGKeyCode key) { SendKey(app, key, 0); }
static void Chord(AXUIElementRef app, NSArray<NSNumber *> *modifiers, CGKeyCode key) {
    CGEventFlags flags = 0;
    for (NSNumber *modifier in modifiers) {
        if (modifier.unsignedShortValue == kVK_Command) flags |= kCGEventFlagMaskCommand;
        if (modifier.unsignedShortValue == kVK_Shift) flags |= kCGEventFlagMaskShift;
        if (modifier.unsignedShortValue == kVK_Option) flags |= kCGEventFlagMaskAlternate;
    }
    SendKey(app, key, flags);
}
static AXUIElementRef WaitID(AXUIElementRef app, NSString *identifier) {
    NSTimeInterval deadline = NSDate.timeIntervalSinceReferenceDate + 6;
    while (NSDate.timeIntervalSinceReferenceDate < deadline) {
        AXUIElementRef found = Find(app, identifier, 0); if (found) return found;
        [NSThread sleepForTimeInterval:0.1];
    }
    return NULL;
}
static BOOL Set(AXUIElementRef element, NSString *value) {
    return element && AXUIElementSetAttributeValue(element, kAXValueAttribute, (__bridge CFTypeRef)value) == kAXErrorSuccess;
}
static BOOL LabelMatches(id value, NSString *label) {
    if (![value isKindOfClass:NSString.class]) return NO;
    NSString *text = value;
    if ([text caseInsensitiveCompare:label] == NSOrderedSame) return YES;
    return text.length > label.length &&
        [[text substringToIndex:label.length] caseInsensitiveCompare:label] == NSOrderedSame &&
        [NSCharacterSet.whitespaceAndNewlineCharacterSet characterIsMember:[text characterAtIndex:label.length]];
}
static NSString *ExportKind(AXUIElementRef row) {
    NSArray *labels = @[@[@"书签", @"Bookmarks"], @[@"阅读列表", @"Reading List"],
        @[@"历史记录", @"History"], @[@"扩展", @"Extensions"],
        @[@"信用卡", @"Credit Cards"], @[@"密码", @"Passwords"]];
    NSMutableArray *values = [NSMutableArray array];
    for (NSString *attribute in @[(__bridge NSString *)kAXTitleAttribute, (__bridge NSString *)kAXDescriptionAttribute]) {
        id value = Attr(row, (__bridge CFStringRef)attribute); if (value) [values addObject:value];
    }
    for (id child in Children(row)) {
        AXUIElementRef element = (__bridge AXUIElementRef)child;
        if (![Attr(element, kAXRoleAttribute) isEqual:@"AXStaticText"]) continue;
        id value = Attr(element, kAXValueAttribute); if (value) [values addObject:value];
        id title = Attr(element, kAXTitleAttribute); if (title) [values addObject:title];
    }
    for (NSArray *pair in labels) for (NSString *label in pair) for (id value in values)
        if (LabelMatches(value, label)) return pair.firstObject;
    return nil;
}
static BOOL IsToggle(AXUIElementRef element) {
    // AXSwitch 是 Safari 开关的子角色。
    return [Attr(element, kAXRoleAttribute) isEqual:@"AXCheckBox"] ||
        [Attr(element, kAXSubroleAttribute) isEqual:@"AXSwitch"];
}
static BOOL WaitToggle(AXUIElementRef element, BOOL wanted) {
    for (NSUInteger attempt = 0; attempt < 20; attempt++) {
        id value = Attr(element, kAXValueAttribute);
        if ([value respondsToSelector:@selector(boolValue)] && [value boolValue] == wanted) return YES;
        [NSThread sleepForTimeInterval:0.1];
    }
    return NO;
}
static void CancelOwnedPanel(AXUIElementRef panel) {
    AXUIElementRef cancel = Find(panel, @"CancelButton", 0); Press(cancel); if (cancel) CFRelease(cancel);
}
static BOOL Export(AXUIElementRef app, NSURL *destination, NSError **error, void (^progress)(NSString *)) {
    // 激活是异步操作，等待 Safari 成为前台应用后再继续。
    for (NSUInteger i = 0; i < 30 && !SafariActive(); i++) [NSThread sleepForTimeInterval:0.1];
    if (!SafariActive()) return Fail(error, @"请先切回 Safari，助手会在 Safari 前台时同步");
    if (progress) progress(@"正在通过 Safari 导出书签，请暂时不要操作导出窗口…");
    id windows = Attr(app, kAXWindowsAttribute);
    for (id window in ([windows isKindOfClass:NSArray.class] ? windows : @[])) {
        if (Children((__bridge AXUIElementRef)window).count &&
            [Attr((__bridge AXUIElementRef)window, kAXRoleAttribute) isEqual:@"AXDialog"])
            return Fail(error, @"Safari 有打开的对话框，请完成后再同步");
        if ([Attr((__bridge AXUIElementRef)window, CFSTR("AXSheets")) count])
            return Fail(error, @"Safari 有打开的表单，请完成后再同步");
    }
    AXUIElementRef menu = (__bridge AXUIElementRef)Attr(app, kAXMenuBarAttribute);
    if (!menu) return Fail(error, @"找不到 Safari 菜单栏");
    BOOL fileOpened = NO;
    for (id child in Children(menu)) {
        AXUIElementRef item = (__bridge AXUIElementRef)child; NSString *title = Attr(item, kAXTitleAttribute);
        if ([title isEqual:@"文件"] || [title isEqual:@"File"]) { fileOpened = Press(item); break; }
    }
    if (!fileOpened) return Fail(error, @"无法打开 Safari 文件菜单；目前支持中文和英文界面");
    AXUIElementRef export = Find(menu, @"Export", 0);
    BOOL opened = Press(export); if (export) CFRelease(export);
    if (!opened) return Fail(error, @"找不到将浏览数据导出到文件；自动同步需要 Safari 26");
    AXUIElementRef panel = WaitID(app, @"ExportBrowsingDataPanel");
    if (!panel) return Fail(error, @"没有打开 Safari 导出对话框");
    NSMutableArray *toggles = [NSMutableArray array]; NSMutableSet *kinds = [NSMutableSet set];
    AXUIElementRef bookmark = NULL;
    for (id row in Children(panel)) {
        AXUIElementRef r = (__bridge AXUIElementRef)row; NSString *kind = ExportKind(r); id toggle = nil;
        for (id child in Children(r)) {
            AXUIElementRef c = (__bridge AXUIElementRef)child;
            if (IsToggle(c)) { [toggles addObject:child]; toggle = child; }
        }
        if (toggle && kind) { [kinds addObject:kind]; if ([kind isEqual:@"书签"]) bookmark = (__bridge AXUIElementRef)toggle; }
    }
    BOOL selectionOK = bookmark && toggles.count == 6 && kinds.count == 6;
    if (!selectionOK) {
        CancelOwnedPanel(panel); CFRelease(panel); return Fail(error, @"无法识别完整的六类导出选项，已取消导出");
    }
    for (id toggle in toggles) {
        AXUIElementRef element = (__bridge AXUIElementRef)toggle;
        BOOL wanted = element == bookmark;
        if ([Attr(element, kAXValueAttribute) boolValue] != wanted) Press(element);
        if (!WaitToggle(element, wanted)) selectionOK = NO;
    }
    if (!selectionOK || !SafariActive()) {
        CancelOwnedPanel(panel); CFRelease(panel); return Fail(error, @"无法确认仅导出书签，已取消导出");
    }
    AXUIElementRef button = Find(panel, @"ExportBrowsingDataButton", 0);
    BOOL pressed = Press(button); if (button) CFRelease(button); CFRelease(panel);
    if (!pressed) return Fail(error, @"无法点击 Safari 导出按钮");
    AXUIElementRef save = WaitID(app, @"save-panel");
    if (!save) return Fail(error, @"没有打开导出保存对话框");
    AXUIElementRef initialName = Find(save, @"saveAsNameTextField", 0);
    BOOL nameReady = NO;
    for (NSUInteger i = 0; initialName && i < 30 && SafariActive(); i++) {
        AXUIElementSetAttributeValue(initialName, kAXFocusedAttribute, kCFBooleanTrue);
        id focused = Attr(app, kAXFocusedUIElementAttribute);
        if (focused && CFEqual((__bridge CFTypeRef)focused, initialName)) { nameReady = YES; break; }
        [NSThread sleepForTimeInterval:0.1];
    }
    if (initialName) CFRelease(initialName);
    if (!nameReady) { CancelOwnedPanel(save); CFRelease(save); return Fail(error, @"保存窗口尚未就绪，已取消导出"); }
    // 每次导出使用独立文件名。
    Chord(app, @[@(kVK_Command), @(kVK_Shift)], kVK_ANSI_G);
    AXUIElementRef go = WaitID(app, @"GoToWindow");
    AXUIElementRef path = go ? Find(go, @"PathTextField", 0) : NULL;
    BOOL located = SafariActive() && Set(path, destination.URLByDeletingLastPathComponent.path);
    if (path) CFRelease(path);
    if (located) Key(app, kVK_Return);
    if (!located) {
        NSString *message = !SafariActive() ? @"Safari 已离开前台，本次导出已取消" :
            !go ? @"保存窗口未打开目录选择器，已取消导出" : @"无法填写书签归档目录，已取消导出";
        if (go) { AXUIElementRef close = Find(go, @"CloseButton", 0); Press(close); if (close) CFRelease(close); }
        if (go) CFRelease(go);
        CancelOwnedPanel(save); CFRelease(save);
        return Fail(error, message);
    }
    BOOL navigationDone = NO;
    NSTimeInterval folderDeadline = NSDate.timeIntervalSinceReferenceDate + 3;
    while (NSDate.timeIntervalSinceReferenceDate < folderDeadline) {
        AXUIElementRef pending = Find(app, @"GoToWindow", 0);
        if (!pending) { navigationDone = YES; break; }
        CFRelease(pending); [NSThread sleepForTimeInterval:0.1];
    }
    AXUIElementRef folder = Find(save, @"where popup", 0);
    BOOL folderOK = navigationDone && [Attr(folder, kAXValueAttribute) isEqual:destination.URLByDeletingLastPathComponent.lastPathComponent];
    if (folder) CFRelease(folder);
    if (!folderOK) {
        AXUIElementRef close = Find(go, @"CloseButton", 0); Press(close); if (close) CFRelease(close);
        if (go) CFRelease(go);
        CancelOwnedPanel(save); CFRelease(save); return Fail(error, @"保存目录未切换到本次导出的临时文件夹，已取消导出");
    }
    if (go) CFRelease(go);
    AXUIElementRef name = Find(save, @"saveAsNameTextField", 0);
    BOOL focused = name && AXUIElementSetAttributeValue(name, kAXFocusedAttribute, kCFBooleanTrue) == kAXErrorSuccess;
    BOOL named = focused && SafariActive() && Set(name, destination.lastPathComponent) &&
        [Attr(name, kAXValueAttribute) isEqual:destination.lastPathComponent];
    if (name) CFRelease(name);
    if (named) {
        Key(app, kVK_Tab); // 提交保存路径后再确认。
        BOOL committed = NO;
        for (NSUInteger i = 0; i < 30 && SafariActive(); i++) {
            id focused = Attr(app, kAXFocusedUIElementAttribute);
            AXUIElementRef field = Find(save, @"saveAsNameTextField", 0);
            if (field && focused && !CFEqual((__bridge CFTypeRef)focused, field) &&
                [Attr(field, kAXValueAttribute) isEqual:destination.lastPathComponent]) committed = YES;
            if (field) CFRelease(field);
            if (committed) break;
            [NSThread sleepForTimeInterval:0.1];
        }
        named = committed;
    }
    AXUIElementRef ok = Find(save, @"OKButton", 0);
    BOOL saved = named && SafariActive() && Press(ok); if (ok) CFRelease(ok);
    if (!saved) CancelOwnedPanel(save); CFRelease(save);
    if (!saved) return Fail(error, @"无法保存 Safari 书签归档");
    if (progress) progress(@"等待 Safari 生成书签归档…");
    // 等待导出文件大小稳定，兼容保存面板关闭后的异步写入。
    unsigned long long previous = 0; NSUInteger stable = 0; BOOL sawAuthentication = NO, authClosed = NO;
    NSTimeInterval deadline = NSDate.timeIntervalSinceReferenceDate + 180;
    NSTimeInterval authenticationDeadline = NSDate.timeIntervalSinceReferenceDate + 1800;
    while (NSDate.timeIntervalSinceReferenceDate < deadline) {
        NSString *front = NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier;
        BOOL authenticating = [front isEqual:@"com.apple.LocalAuthentication.UIAgent"] || SafariAuthenticationOpen();
        if (authenticating) {
            deadline = authenticationDeadline; authClosed = NO;
            if (!sawAuthentication && progress) progress(@"macOS 正在等待系统验证。请在系统密码弹窗中完成或取消；助手不会读取或保存密码。");
            sawAuthentication = YES;
        } else if (sawAuthentication && !authClosed) {
            authClosed = YES;
            deadline = MIN(authenticationDeadline, NSDate.timeIntervalSinceReferenceDate + 180);
            if (progress) progress(@"系统验证窗口已关闭，等待 Safari 生成书签归档…");
        }
        NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:destination.path error:nil];
        unsigned long long size = [attrs[NSFileSize] unsignedLongLongValue];
        stable = size && size == previous ? stable + 1 : 0; previous = size;
        if (stable >= 2) return YES;
        [NSThread sleepForTimeInterval:1];
    }
    return Fail(error, sawAuthentication ? @"Safari 导出等待系统验证超时。请先完成或取消系统弹窗，再点击“立即同步”；上次成功快照保留。" :
        @"Safari 导出超时；原书签和上次成功的快照均保留");
}
BOOL HubExportSafariBookmarks(NSURL *destination, NSError **error, void (^progress)(NSString *)) {
    if (!AXIsProcessTrusted()) return Fail(error, @"请在系统设置 > 隐私与安全性 > 辅助功能中授权书签导航台助手");
    AXUIElementRef app = App(); if (!app) return Fail(error, @"请先打开 Safari");
    BOOL result = Export(app, destination, error, progress); CFRelease(app); return result;
}
static NSArray *MatchingRows(AXUIElementRef outline, NSString *title, NSString *url) {
    NSMutableArray *matches = [NSMutableArray array];
    for (id row in Children(outline)) {
        AXUIElementRef r = (__bridge AXUIElementRef)row;
        AXUIElementRef t = Find(r, @"BookmarkTitle", 0), u = Find(r, @"BookmarkURL", 0);
        if (t && u && [Attr(t, kAXValueAttribute) isEqual:title] && [Attr(u, kAXValueAttribute) isEqual:url]) [matches addObject:row];
        if (t) CFRelease(t); if (u) CFRelease(u);
    }
    return matches;
}
static id FocusedWindow(AXUIElementRef app) {
    id focused = Attr(app, kAXFocusedWindowAttribute);
    if (!focused) {
        id control = Attr(app, kAXFocusedUIElementAttribute);
        if (control) focused = Attr((__bridge AXUIElementRef)control, kAXWindowAttribute);
    }
    return focused;
}
static BOOL SameFocusedWindow(AXUIElementRef app, AXUIElementRef window, NSString *expected) {
    id focused = FocusedWindow(app);
    if (!SafariActive() || !focused) return NO;
    if (CFEqual((__bridge CFTypeRef)focused, window)) return YES;
    // 原生编辑器可能替换 AX 窗口对象，使用窗口 UUID 识别。
    id actual = Attr((__bridge AXUIElementRef)focused, kAXIdentifierAttribute);
    return [expected isKindOfClass:NSString.class] && [expected hasPrefix:@"SafariWindow?"] &&
        [expected rangeOfString:@"&UUID="].location != NSNotFound && [expected isEqual:actual];
}
static BOOL OpenRowContextMenu(AXUIElementRef app, AXUIElementRef window, NSString *windowIdentifier, AXUIElementRef row, NSError **error) {
    // 原生书签行不提供 AXShowMenu，按当前标题控件的位置打开右键菜单。
    if (!SameFocusedWindow(app, window, windowIdentifier)) return Fail(error, @"Safari 前台窗口已变化，未打开删除菜单。" );
    AXUIElementRef title = Find(row, @"BookmarkTitle", 0), url = Find(row, @"BookmarkURL", 0);
    id expectedTitle = Attr(title, kAXValueAttribute), expectedURL = Attr(url, kAXValueAttribute);
    id position = Attr(title, kAXPositionAttribute), size = Attr(title, kAXSizeAttribute);
    if (title) CFRelease(title); if (url) CFRelease(url);
    CGPoint origin; CGSize extent;
    if (!position || !size || CFGetTypeID((__bridge CFTypeRef)position) != AXValueGetTypeID() ||
        CFGetTypeID((__bridge CFTypeRef)size) != AXValueGetTypeID() ||
        !AXValueGetValue((__bridge AXValueRef)position, kAXValueCGPointType, &origin) ||
        !AXValueGetValue((__bridge AXValueRef)size, kAXValueCGSizeType, &extent) ||
        !isfinite(origin.x) || !isfinite(origin.y) || !isfinite(extent.width) || !isfinite(extent.height) ||
        extent.width < 4 || extent.height < 4) return Fail(error, @"Safari 未提供目标名称控件的可见位置，未打开删除菜单。" );
    CGPoint point = CGPointMake(origin.x + extent.width / 2, origin.y + extent.height / 2);
    // 发送鼠标事件前核对命中控件属于目标书签行。
    AXUIElementRef system = AXUIElementCreateSystemWide(), hit = NULL;
    AXUIElementCopyElementAtPosition(system, point.x, point.y, &hit); CFRelease(system);
    BOOL belongs = NO; AXUIElementRef ancestor = hit;
    for (NSUInteger depth = 0; ancestor && depth < 8; depth++) {
        if (CFEqual(ancestor, row)) { belongs = YES; break; }
        if ([Attr(ancestor, kAXRoleAttribute) isEqual:@"AXRow"]) {
            AXUIElementRef t = Find(ancestor, @"BookmarkTitle", 0), u = Find(ancestor, @"BookmarkURL", 0);
            belongs = t && u && [Attr(t, kAXValueAttribute) isEqual:expectedTitle] &&
                [Attr(u, kAXValueAttribute) isEqual:expectedURL];
            if (t) CFRelease(t); if (u) CFRelease(u);
            if (belongs) break;
        }
        id parent = Attr(ancestor, kAXParentAttribute);
        AXUIElementRef next = parent ? (AXUIElementRef)CFRetain((__bridge CFTypeRef)parent) : NULL;
        CFRelease(ancestor); ancestor = next;
    }
    if (ancestor) CFRelease(ancestor);
    if (!belongs) return Fail(error, @"目标书签被遮挡或位置已变化，未打开删除菜单。" );
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
    CGEventRef down = CGEventCreateMouseEvent(source, kCGEventRightMouseDown, point, kCGMouseButtonRight);
    CGEventRef up = CGEventCreateMouseEvent(source, kCGEventRightMouseUp, point, kCGMouseButtonRight);
    BOOL ready = down && up && SameFocusedWindow(app, window, windowIdentifier);
    if (ready) { CGEventPost(kCGSessionEventTap, down); CGEventPost(kCGSessionEventTap, up); }
    if (down) CFRelease(down); if (up) CFRelease(up); if (source) CFRelease(source);
    return ready || Fail(error, @"Safari 窗口已变化或无法发送原生菜单操作，已停止删除。" );
}
static void EditorTabs(AXUIElementRef element, NSMutableArray *tabs, NSUInteger depth) {
    if (!element || depth > 16) return;
    NSString *identifier = Attr(element, kAXIdentifierAttribute);
    if ([identifier isKindOfClass:NSString.class] && [identifier hasPrefix:@"TabBarTab?"]) {
        NSMutableArray *labels = [NSMutableArray array];
        id title = Attr(element, kAXTitleAttribute); if (title) [labels addObject:title];
        for (id child in Children(element)) {
            AXUIElementRef c = (__bridge AXUIElementRef)child;
            if ([Attr(c, kAXRoleAttribute) isEqual:@"AXStaticText"]) {
                id value = Attr(c, kAXValueAttribute); if (value) [labels addObject:value];
            }
        }
        for (id label in labels) if ([label isKindOfClass:NSString.class] &&
            [@[@"书签", @"正在搜索书签", @"搜索书签", @"Bookmarks", @"Searching Bookmarks"] containsObject:label]) {
            [tabs addObject:(__bridge id)element]; break;
        }
        return;
    }
    NSString *role = Attr(element, kAXRoleAttribute);
    if ([role isEqual:@"AXWebArea"] || [role isEqual:@"AXOutline"] || [role isEqual:@"AXTable"]) return;
    for (id child in Children(element)) EditorTabs((__bridge AXUIElementRef)child, tabs, depth + 1);
}
static NSUInteger NativeTabCount(AXUIElementRef element, NSUInteger depth) {
    if (!element || depth > 16) return 0;
    id identifier = Attr(element, kAXIdentifierAttribute);
    if ([identifier isKindOfClass:NSString.class] && [identifier hasPrefix:@"TabBarTab?"]) return 1;
    NSString *role = Attr(element, kAXRoleAttribute);
    if ([role isEqual:@"AXWebArea"] || [role isEqual:@"AXOutline"] || [role isEqual:@"AXTable"]) return 0;
    NSUInteger count = 0;
    for (id child in Children(element)) count += NativeTabCount((__bridge AXUIElementRef)child, depth + 1);
    return count;
}
static BOOL LoadedDocument(AXUIElementRef element, NSUInteger depth) {
    if (!element || depth > 16) return NO;
    NSString *role = Attr(element, kAXRoleAttribute);
    if ([role isEqual:@"AXWebArea"]) {
        id url = Attr(element, kAXURLAttribute), title = Attr(element, kAXTitleAttribute);
        return url != nil || ([title isKindOfClass:NSString.class] && [title length] > 0);
    }
    if ([role isEqual:@"AXOutline"] || [role isEqual:@"AXTable"]) return NO;
    for (id child in Children(element)) if (LoadedDocument((__bridge AXUIElementRef)child, depth + 1)) return YES;
    return NO;
}
static BOOL OpenBookmarkEditor(AXUIElementRef app, AXUIElementRef window) {
    AXUIElementRef existing = Find(window, @"Bookmarks", 0);
    if (existing) { CFRelease(existing); return YES; }
    // 优先复用原生书签编辑器，并通过原生控件核对定位。
    NSMutableArray *tabs = [NSMutableArray array]; EditorTabs(window, tabs, 0);
    for (id tab in tabs) {
        if (!SafariActive()) return NO;
        if (!Press((__bridge AXUIElementRef)tab)) continue;
        existing = WaitID(window, @"Bookmarks");
        if (existing) { CFRelease(existing); return YES; }
    }
    NSUInteger before = NativeTabCount(window, 0);
    if (!SafariActive()) return NO;
    Chord(app, @[@(kVK_Command)], kVK_ANSI_T);
    BOOL opened = NO;
    NSTimeInterval tabDeadline = NSDate.timeIntervalSinceReferenceDate + 10;
    while (SafariActive() && NSDate.timeIntervalSinceReferenceDate < tabDeadline) {
        opened = NativeTabCount(window, 0) > before && LoadedDocument(window, 0);
        if (opened) break;
        [NSThread sleepForTimeInterval:0.1];
    }
    if (!opened) return NO;
    // 通过原生菜单在独立标签页打开编辑器，保留导航台中的待处理请求。
    AXUIElementRef menu = (__bridge AXUIElementRef)Attr(app, kAXMenuBarAttribute);
    AXUIElementRef bookmarks = Find(menu, @"SafariBookmarksMenu", 0);
    BOOL shown = SafariActive() && Press(bookmarks); if (bookmarks) CFRelease(bookmarks);
    AXUIElementRef edit = shown ? Find(menu, @"EditBookmarks", 0) : NULL;
    BOOL edited = SafariActive() && Press(edit); if (edit) CFRelease(edit);
    existing = edited ? WaitID(window, @"Bookmarks") : NULL;
    if (existing) CFRelease(existing);
    return existing != NULL;
}
BOOL HubDeleteSafariBookmark(NSString *title, NSString *url, NSError **error, void (^progress)(NSString *)) {
    if (!AXIsProcessTrusted()) return Fail(error, @"删除需要辅助功能权限，请检查当前 App 的授权。" );
    AXUIElementRef app = App(); if (!app) return Fail(error, @"Safari 未运行");
    id focusedWindow = nil;
    NSTimeInterval activationDeadline = NSDate.timeIntervalSinceReferenceDate + 180;
    BOOL waitingReported = NO;
    while (NSDate.timeIntervalSinceReferenceDate < activationDeadline) {
        focusedWindow = FocusedWindow(app);
        id identifier = focusedWindow ? Attr((__bridge AXUIElementRef)focusedWindow, kAXIdentifierAttribute) : nil;
        if (SafariActive() && [identifier isKindOfClass:NSString.class] && [identifier hasPrefix:@"SafariWindow?"] &&
            ![Attr((__bridge AXUIElementRef)focusedWindow, CFSTR("AXSheets")) count]) break;
        focusedWindow = nil;
        if (!waitingReported && progress) {
            progress(@"删除已确认；请将 Safari 浏览器窗口切到前台，并关闭 Safari 设置或对话框。助手最多等待 3 分钟，未就绪时不会删除。" );
            waitingReported = YES;
        }
        [NSThread sleepForTimeInterval:0.1];
    }
    if (!focusedWindow) { CFRelease(app); return Fail(error, @"等待 Safari 浏览器前台窗口超时，已停止删除。" ); }
    NSString *windowIdentifier = [Attr((__bridge AXUIElementRef)focusedWindow, kAXIdentifierAttribute) copy];
    if (progress) progress(@"正在 Safari 中核对唯一目标及原生删除菜单…" );
    AXUIElementRef window = focusedWindow ? (AXUIElementRef)CFRetain((__bridge CFTypeRef)focusedWindow) : NULL;
    if (!window || !OpenBookmarkEditor(app, window)) {
        if (window) CFRelease(window); CFRelease(app);
        return Fail(error, @"无法打开 Safari 书签管理页；请在 Safari 中先打开“书签 > 编辑书签”，切回导航台后重试。原书签未改动。");
    }
    AXUIElementRef outline = WaitID(window, @"Bookmarks");
    AXUIElementRef search = Find(window, @"BookmarksSearchField", 0);
    BOOL ready = outline && search && SafariActive() &&
        AXUIElementSetAttributeValue(search, kAXFocusedAttribute, kCFBooleanTrue) == kAXErrorSuccess &&
        Set(search, url) && [Attr(search, kAXValueAttribute) isEqual:url];
    // 搜索结果实时更新，避免 Return 打开结果并离开编辑器。
    NSArray *rows = @[];
    NSTimeInterval searchDeadline = NSDate.timeIntervalSinceReferenceDate + 6;
    while (ready && SafariActive() && NSDate.timeIntervalSinceReferenceDate < searchDeadline) {
        rows = MatchingRows(outline, title, url);
        if (rows.count) break;
        [NSThread sleepForTimeInterval:0.1];
    }
    BOOL deleted = NO; NSString *failure = nil;
    if (!ready) failure = @"Safari 书签搜索未就绪，已停止删除。";
    else if (rows.count != 1) failure = rows.count > 1 ? @"存在同名同网址书签，已停止删除，请在 Safari 中核对" : @"Safari 书签管理页未找到准确的名称和网址，已停止删除。";
    else if (SameFocusedWindow(app, window, windowIdentifier)) {
        AXUIElementRef previousMenu = Find(outline, @"SafariContextMenu", 0);
        BOOL opened = !previousMenu && OpenRowContextMenu(app, window, windowIdentifier, (__bridge AXUIElementRef)rows.firstObject, error);
        if (previousMenu) CFRelease(previousMenu);
        AXUIElementRef context = opened ? WaitID(outline, @"SafariContextMenu") : NULL;
        AXUIElementRef command = context ? Find(context, @"DeleteMenuItem", 0) : NULL;
        BOOL verified = command && [Attr(command, kAXEnabledAttribute) boolValue] &&
            MatchingRows(outline, title, url).count == 1 && [Attr(search, kAXValueAttribute) isEqual:url] &&
            SameFocusedWindow(app, window, windowIdentifier);
        if (verified && Press(command)) {
            NSTimeInterval removalDeadline = NSDate.timeIntervalSinceReferenceDate + 6;
            while (NSDate.timeIntervalSinceReferenceDate < removalDeadline) {
                deleted = MatchingRows(outline, title, url).count == 0;
                if (deleted) break;
                [NSThread sleepForTimeInterval:0.1];
            }
            if (!deleted) failure = @"已调用 Safari 的原生删除菜单，但目标仍可见；请检查 Safari，勿重复删除。";
        } else {
            if (context) AXUIElementPerformAction(context, kAXCancelAction);
            failure = !opened && error && *error ? (*error).localizedDescription :
                !context ? @"Safari 未打开目标书签的原生菜单，已停止删除。" :
                !command ? @"Safari 原生菜单没有可用的删除命令，已停止删除。" :
                @"无法核对 Safari 原生删除菜单及其目标，已停止删除。";
        }
        if (command) CFRelease(command); if (context) CFRelease(context);
    } else {
        id current = FocusedWindow(app);
        id currentIdentifier = current ? Attr((__bridge AXUIElementRef)current, kAXIdentifierAttribute) : nil;
        failure = @"Safari 窗口或前台状态已变化，已停止删除。";
        // 诊断只记录窗口身份与可用性，不含书签值或密码。
        if (error) *error = [NSError errorWithDomain:@"SafariAutomation" code:2 userInfo:@{
            NSLocalizedDescriptionKey:failure,
            @"HubDeletionDiagnostic":@{@"safariActive":@(SafariActive()), @"focusedWindowAvailable":@(current != nil),
                @"expectedWindowIdentifier":windowIdentifier ?: @"", @"focusedWindowIdentifier":currentIdentifier ?: @""}}];
    }
    if (search) CFRelease(search);
    if (outline) CFRelease(outline); CFRelease(window); CFRelease(app);
    // 完成后保留编辑器，避免关闭用户已切换的标签页。
    if (deleted) return YES;
    if (error && *error && (*error).userInfo[@"HubDeletionDiagnostic"]) return NO;
    return Fail(error, failure ?: @"无法确认 Safari 删除结果，请检查原书签。" );
}
