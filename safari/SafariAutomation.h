#import <Cocoa/Cocoa.h>
// 在主线程中激活 Safari。
void HubActivateSafari(void);
// 导出和删除运行在宿主串行队列，需先启用辅助功能权限。
BOOL HubExportSafariBookmarks(NSURL *destination, NSError **error, void (^progress)(NSString *));
BOOL HubDeleteSafariBookmark(NSString *title, NSString *url, NSError **error, void (^progress)(NSString *));
