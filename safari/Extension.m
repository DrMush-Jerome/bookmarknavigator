#import <Foundation/Foundation.h>
#import <SafariServices/SafariServices.h>
#import "SyncShared.h"

@interface SafariWebExtensionHandler : NSObject <NSExtensionRequestHandling>
@end

@implementation SafariWebExtensionHandler
- (void)beginRequestWithExtensionContext:(NSExtensionContext *)context {
    NSExtensionItem *input = context.inputItems.firstObject;
    id message = input.userInfo[SFExtensionMessageKey];
    NSURL *directory = HubSyncDirectory(); NSDictionary *response;
    NSString *profile = @"default";
    if (@available(macOS 14.0, *)) {
        id value = input.userInfo[SFExtensionProfileKey];
        if ([value isKindOfClass:NSUUID.class]) profile = [value UUIDString];
    }
    NSURL *profileURL = [directory URLByAppendingPathComponent:@"client-profile.json"];
    NSDictionary *binding = HubReadJSON(profileURL);
    if (directory && !binding) { HubWriteJSON(@{@"profile":profile}, profileURL); binding = HubReadJSON(profileURL); }
    if (![message isKindOfClass:NSDictionary.class] || !directory) {
        response = @{@"ok":@NO, @"error":@"原生助手数据容器不可用；请打开 App 并重新连接。"};
    } else if (![binding[@"profile"] isEqual:profile]) {
        response = @{@"ok":@NO, @"error":@"实验助手仅绑定一个 Safari 用户场景，不向其他用户场景提供书签快照。"};
    } else {
        NSString *action = message[@"action"];
        NSDictionary *state = HubReadJSON([directory URLByAppendingPathComponent:@"snapshot.json"]) ?: @{};
        BOOL running = [NSDate date].timeIntervalSince1970 * 1000 - [state[@"heartbeat"] doubleValue] < 20000;
        if ([action isEqual:@"snapshot"]) {
            NSMutableDictionary *reply = [state mutableCopy]; reply[@"ok"] = @YES; reply[@"running"] = @(running);
            response = reply;
        } else if ([action isEqual:@"delete"] && running && [state[@"enabled"] boolValue]) {
            NSString *title = message[@"title"], *url = message[@"url"], *digest = message[@"digest"];
            if (![title isKindOfClass:NSString.class] || ![url isKindOfClass:NSString.class] ||
                ![digest isKindOfClass:NSString.class] || title.length > 2048 || url.length > 8192 ||
                ![digest isEqual:state[@"digest"]]) response = @{@"ok":@NO, @"error":@"书签快照已变化，请刷新后重试。"};
            else {
                NSString *job = NSUUID.UUID.UUIDString;
                BOOL written = HubWriteJSON(@{@"job":job, @"title":title, @"url":url, @"digest":digest,
                    @"createdAt":@([NSDate date].timeIntervalSince1970 * 1000)},
                    [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"request-%@.json", job]]);
                response = written ? @{@"ok":@YES, @"job":job} : @{@"ok":@NO, @"error":@"无法提交删除请求。"};
            }
        } else if ([action isEqual:@"result"]) {
            NSUUID *job = [message[@"job"] isKindOfClass:NSString.class] ? [[NSUUID alloc] initWithUUIDString:message[@"job"]] : nil;
            NSURL *url = job ? [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"result-%@.json", job.UUIDString]] : nil;
            response = HubReadJSON(url) ?: @{@"ok":@YES, @"pending":@YES};
            if (response[@"deleted"] || response[@"error"]) [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
        } else response = @{@"ok":@NO, @"error":@"请打开书签导航台 App，并启用自动同步。"};
    }
    NSExtensionItem *output = [[NSExtensionItem alloc] init]; output.userInfo = @{SFExtensionMessageKey:response};
    [context completeRequestReturningItems:@[output] completionHandler:nil];
}
@end
