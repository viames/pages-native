-- Copyright (c) 2026 Viames Marino. MIT License.
-- Open once through native Apple Events, then verify the canonical file and ID.
use framework "Foundation"
use scripting additions

on encodeResponse(payload)
  set bytes to current application's NSJSONSerialization's dataWithJSONObject:payload options:0 |error|:(missing value)
  return (current application's NSString's alloc()'s initWithData:bytes encoding:(current application's NSUTF8StringEncoding)) as text
end encodeResponse

on canonicalPath(p)
  return ((current application's NSString's stringWithString:p)'s stringByResolvingSymlinksInPath()) as text
end canonicalPath

on findDocument(targetPath)
  set matches to current application's NSMutableArray's array()
  tell application id "com.apple.iWork.Pages"
    repeat with d in every document
      set documentFile to file of d
      if documentFile is not missing value then
        set documentPath to my canonicalPath(POSIX path of documentFile)
        if (current application's NSString's stringWithString:documentPath)'s isEqualToString:targetPath then
          set itemData to current application's NSMutableDictionary's dictionary()
          itemData's setObject:(id of d) forKey:"document_id"
          itemData's setObject:(name of d) forKey:"name"
          itemData's setObject:documentPath forKey:"path"
          itemData's setObject:(modified of d) forKey:"modified"
          itemData's setObject:(document body of d) forKey:"document_body"
          matches's addObject:itemData
        end if
      end if
    end repeat
  end tell
  if (matches's |count|()) as integer > 1 then error "More than one native document has this canonical file." number -2712
  if (matches's |count|()) as integer is 1 then return matches's objectAtIndex:0
  return missing value
end findDocument

on run argv
  try
    set bytes to current application's NSData's dataWithContentsOfFile:(item 1 of argv)
    set request to current application's NSJSONSerialization's JSONObjectWithData:bytes options:0 |error|:(missing value)
    set targetPath to my canonicalPath(((request's objectForKey:"args")'s objectForKey:"path") as text)
    set targetFile to (POSIX file targetPath) as alias
    set resultData to my findDocument(targetPath)
    if resultData is not missing value then return my encodeResponse({|ok|:true, |result|:resultData})
    tell application id "com.apple.iWork.Pages"
      ignoring application responses
        open targetFile
      end ignoring
    end tell
    set deadline to (current date) + 30
    repeat
      set resultData to my findDocument(targetPath)
      if resultData is not missing value then return my encodeResponse({|ok|:true, |result|:resultData})
      if (current date) > deadline then error "Opening was requested but no matching document is available yet. Inspect Pages before retrying." number -2711
      delay 0.1
    end repeat
  on error errorMessage number errorNumber
    set errorCode to "NATIVE_OPEN_FAILED"
    if errorNumber is -1743 then set errorCode to "AUTOMATION_DENIED"
    if errorNumber is -1712 then set errorCode to "APPLE_EVENT_TIMEOUT"
    if errorNumber is -2711 then set errorCode to "OPEN_PENDING"
    if errorNumber is -2712 then set errorCode to "AMBIGUOUS_DOCUMENT"
    return my encodeResponse({|ok|:false, |error|:{|code|:errorCode, |message|:errorMessage, |details|:{|apple_event_number|:errorNumber}}})
  end try
end run
