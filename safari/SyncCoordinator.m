#import "SyncCoordinator.h"
#import "SyncShared.h"
#import "SafariAutomation.h"
#import <ApplicationServices/ApplicationServices.h>
#import <sys/stat.h>

@interface HubSyncCoordinator ()
@property NSURL *directory;
@property NSMutableDictionary *state;
@property NSOperationQueue *queue;
@property NSTimer *timer;
@property BOOL busy;
@property BOOL initializing;
@property NSString *sourceSignature;
@property NSString *exportSignature;
@property NSTimeInterval lastExport;
@end
@implementation HubSyncCoordinator
- (void)writeState {
    self.state[@"heartbeat"] = @([NSDate date].timeIntervalSince1970 * 1000);
    self.state[@"busy"] = @(self.busy);
    HubWriteJSON(self.state, [self.directory URLByAppendingPathComponent:@"snapshot.json"]);
    if (self.onStatus) self.onStatus(self.state[@"error"] ?: (self.busy ? (self.state[@"phase"] ?: @"Safari 书签同步中，请暂时不要操作导出窗口…") :
        self.state[@"lastDeleteError"] ?: (self.enabled ? @"自动同步已开启；助手需保持运行，Safari 在前台时处理变更。" : @"自动同步未开启；本地导入库仍可使用。")));
}
- (void)start {
    if (self.initializing || self.busy) return;
    self.initializing = YES;
    [self.timer invalidate]; self.timer = nil;
    self.state = [NSMutableDictionary dictionary];
    self.queue = [[NSOperationQueue alloc] init]; self.queue.maxConcurrentOperationCount = 1;
    if (self.onStatus) self.onStatus(@"正在检查同步数据容器；如系统弹出访问请求，请核对本 App 后授权。" );
    // 容器授权可能阻塞 mkdir；后台初始化以保持宿主窗口响应。
    [self.queue addOperationWithBlock:^{
        NSURL *directory = HubSyncDirectory();
        NSDictionary *state = HubReadJSON([directory URLByAppendingPathComponent:@"snapshot.json"]) ?: @{};
        dispatch_async(dispatch_get_main_queue(), ^{
            self.initializing = NO;
            self.directory = directory; self.state = [state mutableCopy];
            if (!directory) {
                if (self.onStatus) self.onStatus(@"扩展数据容器未就绪。请先启用 Safari 扩展并打开一次导航台，再点击“重新连接”；签名版还需检查 App Group。" );
                return;
            }
            [self writeState];
            // 删除确认框的模态循环期间保持状态心跳；busy 时不启动第二个操作。
            self.timer = [NSTimer timerWithTimeInterval:3 target:self selector:@selector(tick:) userInfo:nil repeats:YES];
            [NSRunLoop.mainRunLoop addTimer:self.timer forMode:NSRunLoopCommonModes];
            [NSRunLoop.mainRunLoop addTimer:self.timer forMode:NSModalPanelRunLoopMode];
        });
    }];
}
- (BOOL)enabled { return [self.state[@"enabled"] boolValue]; }
- (BOOL)ready { return self.directory != nil && !self.initializing; }
- (void)setEnabled:(BOOL)enabled {
    if (!self.directory) return;
    self.state[@"enabled"] = @(enabled);
    [self.state removeObjectForKey:@"lastDeleteError"];
    [self.state removeObjectForKey:@"lastDeleteDiagnostic"];
    [self.state removeObjectForKey:@"error"]; self.sourceSignature = nil;
    [self writeState]; if (enabled) [self syncNow];
}
- (NSString *)signature {
    struct stat info;
    NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Safari/Bookmarks.plist"];
    if (stat(path.fileSystemRepresentation, &info) != 0) return nil;
    return [NSString stringWithFormat:@"%lld:%ld:%lld", (long long)info.st_mtimespec.tv_sec, info.st_mtimespec.tv_nsec, (long long)info.st_size];
}
- (void)tick:(id)sender {
    [self writeState];
    if (self.busy || !self.enabled) return;
    for (NSURL *url in [[NSFileManager defaultManager] contentsOfDirectoryAtURL:self.directory includingPropertiesForKeys:nil options:0 error:nil]) {
        if ([url.lastPathComponent hasPrefix:@"request-"] && [url.pathExtension isEqual:@"json"]) {
            NSDictionary *request = HubReadJSON(url);
            [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
            [self processRequest:request]; return;
        }
    }
    NSString *signature = [self signature];
    if (!signature) {
        self.state[@"error"] = @"无法观察 Safari 书签文件的变更；可用“立即同步”，自动监测暂不可用。";
        [self writeState]; return;
    }
    BOOL safariActive = [[[NSWorkspace sharedWorkspace] frontmostApplication].bundleIdentifier isEqual:@"com.apple.Safari"];
    // 通过元数据检测变化，导出和修改交给 Safari。
    if (safariActive && ![signature isEqual:self.sourceSignature] && [NSDate date].timeIntervalSince1970 - self.lastExport > 15)
        [self syncNow];
}
- (NSString *)exportHTML:(NSError **)error {
    // 导出期间保留初始签名，下一轮仍能检测到并发变更。
    self.exportSignature = [self signature];
    // 临时归档保存在普通目录，校验后的 HTML 再写入扩展容器。
    NSString *identifier = NSUUID.UUID.UUIDString;
    NSURL *temporary = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:
        [@"bookmarknavigator-export-" stringByAppendingString:identifier]] isDirectory:YES];
    if (![NSFileManager.defaultManager createDirectoryAtURL:temporary withIntermediateDirectories:NO
        attributes:@{NSFilePosixPermissions:@0700} error:error]) return nil;
    NSURL *file = [temporary URLByAppendingPathComponent:[identifier stringByAppendingString:@".zip"]];
    NSString *html = nil;
    void (^progress)(NSString *) = ^(NSString *phase) {
        dispatch_sync(dispatch_get_main_queue(), ^{ self.state[@"phase"] = phase; [self writeState]; });
    };
    if (HubExportSafariBookmarks(file, error, progress)) html = HubReadBookmarkArchive(file, error);
    [[NSFileManager defaultManager] removeItemAtURL:temporary error:nil];
    return html;
}
- (void)publishHTML:(NSString *)html error:(NSError *)error {
    dispatch_sync(dispatch_get_main_queue(), ^{
        self.sourceSignature = self.exportSignature;
        [self.state removeObjectForKey:@"phase"];
        if (html) {
            self.state[@"html"] = html; self.state[@"digest"] = HubDigest([html dataUsingEncoding:NSUTF8StringEncoding]);
            self.state[@"updatedAt"] = @([NSDate date].timeIntervalSince1970 * 1000);
            [self.state removeObjectForKey:@"error"];
        } else self.state[@"error"] = error.localizedDescription ?: @"同步失败，保留上次成功的书签快照。";
        // 导出失败后等待书签再次变化或用户重试。
        [self writeState];
    });
}
- (void)syncNow {
    if (!self.directory || self.busy || !self.enabled) return;
    [self.state removeObjectForKey:@"error"];
    [self.state removeObjectForKey:@"lastDeleteError"];
    [self.state removeObjectForKey:@"lastDeleteDiagnostic"];
    self.busy = YES; self.lastExport = [NSDate date].timeIntervalSince1970; [self writeState];
    [self.queue addOperationWithBlock:^{
        NSError *error = nil; NSString *html = [self exportHTML:&error]; [self publishHTML:html error:error];
        dispatch_async(dispatch_get_main_queue(), ^{ self.busy = NO; [self.state removeObjectForKey:@"phase"]; [self writeState]; });
    }];
}
- (void)processRequest:(NSDictionary *)request {
    NSString *job = request[@"job"], *title = request[@"title"], *url = request[@"url"], *digest = request[@"digest"];
    NSUUID *identifier = [job isKindOfClass:NSString.class] ? [[NSUUID alloc] initWithUUIDString:job] : nil;
    if (!identifier) return;
    NSURL *resultURL = [self.directory URLByAppendingPathComponent:[NSString stringWithFormat:@"result-%@.json", identifier.UUIDString]];
    if (![title isKindOfClass:NSString.class] || ![url isKindOfClass:NSString.class] ||
        ![digest isKindOfClass:NSString.class] || title.length > 2048 || url.length > 8192 ||
        fabs([NSDate date].timeIntervalSince1970 * 1000 - [request[@"createdAt"] doubleValue]) > 300000) {
        HubWriteJSON(@{@"ok":@NO, @"error":@"删除请求无效或已过期"}, resultURL); return;
    }
    [self.state removeObjectForKey:@"lastDeleteError"];
    [self.state removeObjectForKey:@"lastDeleteDiagnostic"];
    self.busy = YES; [self writeState];
    [self.queue addOperationWithBlock:^{
        NSError *error = nil; BOOL deleted = NO; NSString *failure = nil;
        NSString *fresh = [self exportHTML:&error];
        if (!fresh) failure = error.localizedDescription;
        else if (![HubDigest([fresh dataUsingEncoding:NSUTF8StringEncoding]) isEqual:digest]) {
            failure = @"Safari 书签已变化，已刷新快照；请重新选择删除目标。";
            [self publishHTML:fresh error:nil];
        } else if (HubBookmarkMatchCount(fresh, title, url) != 1) failure = @"目标不存在或存在同名同网址书签，已停止删除。";
        if (!failure) {
            // 删除请求需由宿主再次确认。
            __block BOOL approved = NO;
            dispatch_sync(dispatch_get_main_queue(), ^{
                self.state[@"phase"] = @"请核对原生助手里的删除确认；确认前不会修改 Safari 书签。"; [self writeState];
                [NSApp activateIgnoringOtherApps:YES];
                NSAlert *alert = [[NSAlert alloc] init]; alert.messageText = @"从 Safari 删除这个书签？";
                alert.informativeText = [NSString stringWithFormat:@"%@\n%@\n\n将修改 Safari 原书签，可能经 iCloud 同步到其他设备。导航台会保存删除记录，但本版不能自动写回恢复。", title, url];
                [alert addButtonWithTitle:@"取消"]; [alert addButtonWithTitle:@"删除 Safari 书签"];
                approved = [alert runModal] == NSAlertSecondButtonReturn;
            });
            if (!approved) failure = @"已取消 Safari 书签删除。";
            else {
                // 模态循环结束后重新激活 Safari，避免宿主窗口覆盖编辑器。
                dispatch_sync(dispatch_get_main_queue(), ^{
                    self.state[@"phase"] = @"正在 Safari 中核对唯一删除目标…"; [self writeState];
                    HubActivateSafari();
                });
                deleted = HubDeleteSafariBookmark(title, url, &error, ^(NSString *phase) {
                    dispatch_sync(dispatch_get_main_queue(), ^{ self.state[@"phase"] = phase; [self writeState]; });
                });
                if (!deleted) failure = error.localizedDescription;
            }
        }
        if (deleted) {
            NSString *after = [self exportHTML:&error];
            if (!after || HubBookmarkMatchCount(after, title, url) != 0) failure = @"Safari 删除操作已执行，但导出复核未完成。请检查 Safari，勿重复删除。";
            if (after) [self publishHTML:after error:nil];
        }
        HubWriteJSON(@{@"ok":@(!failure), @"deleted":@(deleted), @"error":failure ?: @""}, resultURL);
        dispatch_async(dispatch_get_main_queue(), ^{
            self.busy = NO; [self.state removeObjectForKey:@"phase"];
            if (failure) self.state[@"lastDeleteError"] = [@"本次删除未完成：" stringByAppendingString:failure];
            else [self.state removeObjectForKey:@"lastDeleteError"];
            if (failure && error.userInfo[@"HubDeletionDiagnostic"]) self.state[@"lastDeleteDiagnostic"] = error.userInfo[@"HubDeletionDiagnostic"];
            else [self.state removeObjectForKey:@"lastDeleteDiagnostic"];
            [self writeState];
        });
    }];
}
@end
