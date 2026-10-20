-- Copyright (c) 2026 Viames Marino. MIT License.
-- Fixed native Pages commands. Content arrives through a private JSON file, never source.
use framework "Foundation"
use scripting additions

on encodeResponse(payload)
  set jsonData to current application's NSJSONSerialization's dataWithJSONObject:payload options:0 |error|:(missing value)
  return (current application's NSString's alloc()'s initWithData:jsonData encoding:(current application's NSUTF8StringEncoding)) as text
end encodeResponse

on run argv
  set completedCount to 0
  set actionName to ""
  try
    set bytes to current application's NSData's dataWithContentsOfFile:(item 1 of argv)
    set request to current application's NSJSONSerialization's JSONObjectWithData:bytes options:0 |error|:(missing value)
    set actionName to (request's objectForKey:"action") as text
    set args to request's objectForKey:"args"
    set docID to (args's objectForKey:"document_id") as text
    set resultData to current application's NSMutableDictionary's dictionary()
    tell application id "com.apple.iWork.Pages"
      set docs to every document whose id is docID
      if (count docs) is not 1 then error "DOCUMENT_NOT_FOUND: Reopen the document and use its current ID." number -2701
      set d to item 1 of docs
      if actionName is "fill_placeholders" then
        set expectedRecords to (args's objectForKey:"_expected_placeholders")'s objectForKey:"placeholders"
        set expectedCount to (expectedRecords's |count|()) as integer
        if (count placeholder texts of d) is not expectedCount then error "REVISION_CHANGED: Native placeholder count changed." number -2705
        repeat with placeholderIndex from 1 to expectedCount
          set expectedRecord to expectedRecords's objectAtIndex:(placeholderIndex - 1)
          set expectedTag to (expectedRecord's objectForKey:"tag") as text
          set expectedText to (expectedRecord's objectForKey:"text") as text
          set nativeTag to tag of placeholder text placeholderIndex of d
          set nativeText to placeholder text placeholderIndex of d as text
          if not ((current application's NSString's stringWithString:nativeTag)'s isEqualToString:expectedTag) then error "REVISION_CHANGED: Native placeholder tag changed." number -2705
          if not ((current application's NSString's stringWithString:nativeText)'s isEqualToString:expectedText) then error "REVISION_CHANGED: Native placeholder text changed." number -2705
        end repeat
        set replacements to args's objectForKey:"replacements"
        repeat with replacementIndex from 0 to ((replacements's |count|()) as integer) - 1
          set replacementData to replacements's objectAtIndex:replacementIndex
          set placeholderIndex to (replacementData's objectForKey:"index") as integer
          set replacementText to (replacementData's objectForKey:"text") as text
          set expectedTag to (replacementData's objectForKey:"tag") as text
          set expectedText to (replacementData's objectForKey:"before") as text
          if not ((current application's NSString's stringWithString:(tag of placeholder text placeholderIndex of d))'s isEqualToString:expectedTag) then error "REVISION_CHANGED: Native placeholder tag changed during filling." number -2705
          if not ((current application's NSString's stringWithString:(placeholder text placeholderIndex of d as text))'s isEqualToString:expectedText) then error "REVISION_CHANGED: Native placeholder text changed during filling." number -2705
          set placeholder text placeholderIndex of d to replacementText
          set completedCount to completedCount + 1
        end repeat
        set remainingRecords to current application's NSMutableArray's array()
        repeat with placeholderIndex from 1 to (count placeholder texts of d)
          set remainingRecord to current application's NSMutableDictionary's dictionary()
          remainingRecord's setObject:placeholderIndex forKey:"index"
          remainingRecord's setObject:(tag of placeholder text placeholderIndex of d) forKey:"tag"
          remainingRecord's setObject:(placeholder text placeholderIndex of d as text) forKey:"text"
          remainingRecords's addObject:remainingRecord
        end repeat
        resultData's setObject:completedCount forKey:"completed"
        resultData's setObject:remainingRecords forKey:"remaining"
      else if actionName is "cell_formats" then
        set tableIndex to (args's objectForKey:"table") as integer
        set rangeName to (args's objectForKey:"range") as text
        set formats to format of every cell of range rangeName of table tableIndex of d
        set labels to {}
        repeat with f in formats
          set f to contents of f
          if f is text then
            set end of labels to "text"
          else if f is number then
            set end of labels to "number"
          else if f is automatic then
            set end of labels to "automatic"
          else if f is currency then
            set end of labels to "currency"
          else if f is percent then
            set end of labels to "percent"
          else if f is date and time then
            set end of labels to "date and time"
          else if f is duration then
            set end of labels to "duration"
          else if f is fraction then
            set end of labels to "fraction"
          else if f is scientific then
            set end of labels to "scientific"
          else if f is checkbox then
            set end of labels to "checkbox"
          else
            set end of labels to "other"
          end if
        end repeat
        resultData's setObject:labels forKey:"formats"
      else
        set targetData to args's objectForKey:"target"
        set kindName to (targetData's objectForKey:"kind") as text
        if kindName is "body" then
          if not (document body of d) then error "NO_DOCUMENT_BODY: Choose a text item for a page-layout document." number -2702
          set richText to a reference to body text of d
        else
          set targetIndex to (targetData's objectForKey:"index") as integer
          if kindName is "section" then
            set richText to a reference to body text of section targetIndex of d
          else if kindName is "page" then
            set richText to a reference to body text of page targetIndex of d
          else if kindName is "text" then
            set richText to a reference to object text of text item targetIndex of d
          else if kindName is "shape" then
            set richText to a reference to object text of shape targetIndex of d
          else
            error "INVALID_TARGET: Unknown native text target." number -2703
          end if
        end if
        set originalText to richText as text
        set nativeCharacters to every character of richText
        if (count nativeCharacters) > 100000 then error "TEXT_LIMIT: Choose a smaller text target." number -2704
        if actionName is "text_apply" then
          if not ((current application's NSString's stringWithString:originalText)'s isEqualToString:((args's objectForKey:"expected_text") as text)) then error "REVISION_CHANGED: Native text changed before editing." number -2705
          set nativeEdits to args's objectForKey:"edits"
          repeat with editIndex from 0 to ((nativeEdits's |count|()) as integer) - 1
            set editData to nativeEdits's objectAtIndex:editIndex
            set startIndex to (editData's objectForKey:"start") as integer
            set deleteCount to (editData's objectForKey:"delete_count") as integer
            set insertedText to (editData's objectForKey:"text") as text
            if deleteCount is 0 then
              if (count nativeCharacters) is 0 then
                set contents of richText to insertedText
              else if startIndex is 1 then
                set firstText to character 1 of richText as text
                set character 1 of richText to insertedText & firstText
              else
                set preceding to character (startIndex - 1) of richText as text
                set character (startIndex - 1) of richText to preceding & insertedText
              end if
            else
              set endIndex to startIndex + deleteCount - 1
              -- Pages broadcasts an assignment to each character in a range.
              -- Delete individual characters from the end, then replace one
              -- remaining character so the inserted text inherits its style.
              if insertedText is "" then
                repeat with characterIndex from endIndex to startIndex by -1
                  delete character characterIndex of richText
                end repeat
              else
                repeat with characterIndex from endIndex to (startIndex + 1) by -1
                  delete character characterIndex of richText
                end repeat
                set character startIndex of richText to insertedText
              end if
            end if
            set completedCount to completedCount + 1
          end repeat
          resultData's setObject:completedCount forKey:"completed_edits"
        else if actionName is "text_format" then
          set expectedStyle to args's objectForKey:"_expected_style"
          if expectedStyle is missing value then error "PREVIEW_REQUIRED: Preview native formatting before applying it." number -2710
          if not ((current application's NSString's stringWithString:originalText)'s isEqualToString:((expectedStyle's objectForKey:"text") as text)) then error "REVISION_CHANGED: Text changed before formatting." number -2705
          set currentFonts to current application's NSArray's arrayWithArray:(font of every character of richText)
          set currentSizes to current application's NSArray's arrayWithArray:(size of every character of richText)
          set currentColors to current application's NSArray's arrayWithArray:(color of every character of richText)
          if not (currentFonts's isEqualToArray:(expectedStyle's objectForKey:"fonts")) then error "REVISION_CHANGED: Font changed before formatting." number -2705
          if not (currentSizes's isEqualToArray:(expectedStyle's objectForKey:"sizes")) then error "REVISION_CHANGED: Font size changed before formatting." number -2705
          if not (currentColors's isEqualToArray:(expectedStyle's objectForKey:"colors")) then error "REVISION_CHANGED: Text color changed before formatting." number -2705
          set firstIndex to (args's objectForKey:"first") as integer
          set lastIndex to (args's objectForKey:"last") as integer
          if firstIndex < 1 or lastIndex < firstIndex or lastIndex > (count nativeCharacters) then error "TEXT_RANGE: Formatting range exceeds native characters." number -2706
          set styleData to args's objectForKey:"style"
          set v to styleData's objectForKey:"font_name"
          if v is not missing value then set font of characters firstIndex thru lastIndex of richText to v as text
          set v to styleData's objectForKey:"font_size"
          if v is not missing value then set size of characters firstIndex thru lastIndex of richText to v as real
          set v to styleData's objectForKey:"color"
          if v is not missing value then set color of characters firstIndex thru lastIndex of richText to v as list
          resultData's setObject:firstIndex forKey:"first"
          resultData's setObject:lastIndex forKey:"last"
          resultData's setObject:(font of character firstIndex of richText) forKey:"first_font"
          resultData's setObject:(size of character firstIndex of richText) forKey:"first_size"
        else if actionName is not "text_snapshot" then
          error "UNKNOWN_ACTION: Unknown text operation." number -2707
        end if
        resultData's setObject:(richText as text) forKey:"text"
        resultData's setObject:(every character of richText) forKey:"characters"
        resultData's setObject:(every paragraph of richText) forKey:"paragraphs"
        set withStyles to args's objectForKey:"include_styles"
        if actionName is "text_format" or (withStyles is not missing value and withStyles as boolean is true) then
          if (count nativeCharacters) > 10000 then error "STYLE_LIMIT: Choose a smaller text target for per-character styles." number -2708
          resultData's setObject:(font of every character of richText) forKey:"fonts"
          resultData's setObject:(size of every character of richText) forKey:"sizes"
          resultData's setObject:(color of every character of richText) forKey:"colors"
        end if
      end if
    end tell
    return my encodeResponse({|ok|:true, |result|:resultData})
  on error errorMessage number errorNumber
    set errorCode to "NATIVE_TEXT_ERROR"
    if errorNumber is -1743 then set errorCode to "AUTOMATION_DENIED"
    if errorNumber is -1712 then set errorCode to "APPLE_EVENT_TIMEOUT"
    if errorNumber is -2701 then set errorCode to "DOCUMENT_NOT_FOUND"
    if errorNumber is -2702 then set errorCode to "NO_DOCUMENT_BODY"
    if errorNumber is -2704 then set errorCode to "TEXT_LIMIT"
    if errorNumber is -2705 then set errorCode to "REVISION_CHANGED"
    if errorNumber is -2706 then set errorCode to "TEXT_RANGE"
    if errorNumber is -2708 then set errorCode to "STYLE_LIMIT"
    if errorNumber is -2710 then set errorCode to "PREVIEW_REQUIRED"
    if actionName is "fill_placeholders" then
      if completedCount > 0 then
        set errorCode to "PARTIAL_WRITE"
      else if errorNumber is not -2705 then
        set errorCode to "PLACEHOLDER_WRITE_FAILED"
      end if
    end if
    return my encodeResponse({|ok|:false, |error|:{|code|:errorCode, |message|:errorMessage, |details|:{|apple_event_number|:errorNumber, |completed_edits|:completedCount}}})
  end try
end run
