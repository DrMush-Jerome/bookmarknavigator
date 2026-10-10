#import <Cocoa/Cocoa.h>
@interface HubSyncCoordinator : NSObject
@property (copy) void (^onStatus)(NSString *text);
- (void)start;
- (void)setEnabled:(BOOL)enabled;
- (BOOL)enabled;
- (BOOL)ready;
- (void)syncNow;
@end
