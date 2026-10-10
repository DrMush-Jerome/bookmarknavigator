#import "SyncShared.h"
#import <CommonCrypto/CommonDigest.h>
#import <zlib.h>

NSURL *HubSyncDirectory(void) {
    NSBundle *bundle = NSBundle.mainBundle; NSURL *base;
    if ([[bundle objectForInfoDictionaryKey:@"HubSyncTransport"] isEqual:@"extension-container"]) {
        NSString *extensionID = [bundle objectForInfoDictionaryKey:@"HubExtensionIdentifier"];
        if ([bundle.bundleIdentifier isEqual:extensionID]) {
            base = [NSURL fileURLWithPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support"] isDirectory:YES];
        } else {
            // 本地 ad-hoc 包没有开发团队配置，使用本扩展容器代替 App Group。
            NSString *home = [NSHomeDirectory() stringByAppendingPathComponent:
                [NSString stringWithFormat:@"Library/Containers/%@/Data", extensionID]];
            BOOL directory = NO;
            if (![[NSFileManager defaultManager] fileExistsAtPath:home isDirectory:&directory] || !directory) return nil;
            base = [NSURL fileURLWithPath:[home stringByAppendingPathComponent:@"Library/Application Support"] isDirectory:YES];
        }
    } else {
        NSString *group = [bundle objectForInfoDictionaryKey:@"HubAppGroup"];
        if (!group.length) return nil;
        base = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:group];
    }
    if (!base) return nil;
    NSURL *dir = [base URLByAppendingPathComponent:@"SafariSync" isDirectory:YES];
    if (![[NSFileManager defaultManager] createDirectoryAtURL:dir withIntermediateDirectories:YES
        attributes:@{NSFilePosixPermissions:@0700} error:nil]) return nil;
    return dir;
}
NSDictionary *HubReadJSON(NSURL *url) {
    if (!url) return nil;
    NSNumber *size; [url getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
    if (size.unsignedLongLongValue > 16 * 1024 * 1024) return nil;
    NSData *data = [NSData dataWithContentsOfURL:url];
    id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    return [value isKindOfClass:NSDictionary.class] ? value : nil;
}
BOOL HubWriteJSON(NSDictionary *value, NSURL *url) {
    if (!url) return NO;
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if (!data || ![data writeToURL:url options:NSDataWritingAtomic error:nil]) return NO;
    [[NSFileManager defaultManager] setAttributes:@{NSFilePosixPermissions:@0600} ofItemAtPath:url.path error:nil];
    return YES;
}
NSString *HubDigest(NSData *data) {
    unsigned char bytes[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(data.bytes, (CC_LONG)data.length, bytes);
    NSMutableString *result = [NSMutableString string];
    for (NSUInteger i = 0; i < sizeof(bytes); i++) [result appendFormat:@"%02x", bytes[i]];
    return result;
}
static NSString *ArchiveFailure(NSError **error, NSString *message) {
    if (error) *error = [NSError errorWithDomain:@"SafariSync" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];
    return nil;
}
static uint16_t U16(const unsigned char *p) { return p[0] | ((uint16_t)p[1] << 8); }
static uint32_t U32(const unsigned char *p) { return U16(p) | ((uint32_t)U16(p + 2) << 16); }
NSString *HubReadBookmarkArchive(NSURL *url, NSError **error) {
    NSData *zip = [NSData dataWithContentsOfURL:url];
    if (!zip || zip.length < 22 || zip.length > 50 * 1024 * 1024)
        return ArchiveFailure(error, @"导出归档不存在或超过 50 MB");
    const unsigned char *bytes = zip.bytes; NSUInteger end = NSNotFound;
    NSUInteger minimum = zip.length > 65557 ? zip.length - 65557 : 0;
    for (NSInteger i = (NSInteger)zip.length - 22; i >= (NSInteger)minimum; i--) {
        if (U32(bytes + i) == 0x06054b50 && (NSUInteger)i + 22 + U16(bytes + i + 20) == zip.length) { end = (NSUInteger)i; break; }
    }
    if (end == NSNotFound || U16(bytes + end + 4) || U16(bytes + end + 6))
        return ArchiveFailure(error, @"不支持分卷或无效的 ZIP 归档");
    NSUInteger count = U16(bytes + end + 10), offset = U32(bytes + end + 16), centralSize = U32(bytes + end + 12);
    if (!count || count > 1000 || count != U16(bytes + end + 8) || offset + centralSize != end)
        return ArchiveFailure(error, @"无效或过大的 ZIP 目录");
    NSData *html = nil; BOOL valid = YES;
    for (NSUInteger index = 0; index < count; index++) {
        if (offset + 46 > end || U32(bytes + offset) != 0x02014b50) { valid = NO; break; }
        const unsigned char *entry = bytes + offset;
        NSUInteger nameLength = U16(entry + 28), extra = U16(entry + 30), comment = U16(entry + 32);
        NSUInteger next = offset + 46 + nameLength + extra + comment;
        if (next > end || !nameLength) { valid = NO; break; }
        NSData *nameBytes = [zip subdataWithRange:NSMakeRange(offset + 46, nameLength)];
        NSString *name = [[NSString alloc] initWithData:nameBytes encoding:NSUTF8StringEncoding] ?: [[NSString alloc] initWithData:nameBytes encoding:NSISOLatin1StringEncoding];
        uint16_t flags = U16(entry + 8), method = U16(entry + 10);
        uint32_t size = U32(entry + 24), compressed = U32(entry + 20), local = U32(entry + 42), crc = U32(entry + 16);
        uint32_t mode = U32(entry + 38) >> 16;
        if ((flags & 1) || (mode & 0170000) == 0120000) { valid = NO; break; }
        if (![name hasSuffix:@"/"] && ![name hasPrefix:@"__MACOSX/"]) {
            // 仅读取归档中唯一且大小受限的书签 HTML，不解压其他浏览数据。
            if (![name.pathExtension.lowercaseString isEqual:@"html"] || html || size > 10 * 1024 * 1024 ||
                (method != 0 && method != 8) || local + 30ULL > zip.length || U32(bytes + local) != 0x04034b50 ||
                U16(bytes + local + 8) != method || U16(bytes + local + 6) != flags) { valid = NO; break; }
            NSUInteger start = local + 30ULL + U16(bytes + local + 26) + U16(bytes + local + 28);
            if (start + (uint64_t)compressed > U32(bytes + end + 16)) { valid = NO; break; }
            NSMutableData *output = [NSMutableData dataWithLength:size];
            if (method == 0) {
                if (compressed != size) { valid = NO; break; }
                memcpy(output.mutableBytes, bytes + start, size);
            } else {
                z_stream stream = {0}; stream.next_in = (Bytef *)(bytes + start); stream.avail_in = compressed;
                stream.next_out = output.mutableBytes; stream.avail_out = size;
                if (inflateInit2(&stream, -MAX_WBITS) != Z_OK) { valid = NO; break; }
                int result = inflate(&stream, Z_FINISH);
                BOOL complete = result == Z_STREAM_END && stream.total_out == size && stream.total_in == compressed;
                inflateEnd(&stream); if (!complete) { valid = NO; break; }
            }
            if ((uint32_t)crc32(0, output.bytes, size) != crc) { valid = NO; break; }
            html = output;
        }
        offset = next;
    }
    if (offset != end) valid = NO;
    NSString *text = html ? [[NSString alloc] initWithData:html encoding:NSUTF8StringEncoding] : nil;
    if (!valid || ![text containsString:@"NETSCAPE-Bookmark-file"])
        return ArchiveFailure(error, @"归档必须只包含书签 HTML；请取消密码、历史记录、信用卡等其他数据");
    return text;
}
static NSString *Decode(NSString *text) {
    NSRegularExpression *entities = [NSRegularExpression regularExpressionWithPattern:@"&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);" options:0 error:nil];
    NSMutableString *result = [text mutableCopy];
    for (NSTextCheckingResult *match in [[entities matchesInString:text options:0 range:NSMakeRange(0, text.length)] reverseObjectEnumerator]) {
        NSString *entity = [text substringWithRange:[match rangeAtIndex:1]], *replacement = nil;
        if ([entity hasPrefix:@"#"]) {
            unsigned long value = strtoul([[entity substringFromIndex:[entity hasPrefix:@"#x"] ? 2 : 1] UTF8String], NULL, [entity hasPrefix:@"#x"] ? 16 : 10);
            if (value > 0 && value <= 0x10FFFF && !(value >= 0xD800 && value <= 0xDFFF)) {
                if (value > 0xFFFF) {
                    unichar pair[] = {(unichar)(0xD800 + ((value - 0x10000) >> 10)), (unichar)(0xDC00 + ((value - 0x10000) & 1023))};
                    replacement = [NSString stringWithCharacters:pair length:2];
                } else { unichar character = (unichar)value; replacement = [NSString stringWithCharacters:&character length:1]; }
            }
        } else replacement = @{@"amp":@"&", @"lt":@"<", @"gt":@">", @"quot":@"\"", @"apos":@"'", @"nbsp":@"\u00a0"}[entity];
        if (replacement) [result replaceCharactersInRange:match.range withString:replacement];
    }
    return result;
}
NSUInteger HubBookmarkMatchCount(NSString *html, NSString *title, NSString *url) {
    NSRegularExpression *anchors = [NSRegularExpression regularExpressionWithPattern:@"<A\\s+HREF=\"([^\"]*)\"[^>]*>([^<]*)</A>" options:NSRegularExpressionCaseInsensitive error:nil];
    NSUInteger count = 0;
    for (NSTextCheckingResult *match in [anchors matchesInString:html options:0 range:NSMakeRange(0, html.length)]) {
        if ([Decode([html substringWithRange:[match rangeAtIndex:1]]) isEqual:url] &&
            [Decode([html substringWithRange:[match rangeAtIndex:2]]) isEqual:title]) count++;
    }
    return count;
}
