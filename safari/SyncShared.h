#import <Foundation/Foundation.h>
NSURL *HubSyncDirectory(void);
NSDictionary *HubReadJSON(NSURL *url);
BOOL HubWriteJSON(NSDictionary *value, NSURL *url);
NSString *HubDigest(NSData *data);
NSString *HubReadBookmarkArchive(NSURL *url, NSError **error);
NSUInteger HubBookmarkMatchCount(NSString *html, NSString *title, NSString *url);
