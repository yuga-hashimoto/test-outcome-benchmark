import { describe, expect, it } from 'vitest';
import { isLikelyTestFilePath, stripTestFileHunks } from '@tob/core';

describe('isLikelyTestFilePath', () => {
  /** Real evidence-file paths cited across data/oss/*.json, spanning every
   * language and test-naming convention in this dataset. */
  it.each([
    'test/display.test.js',
    'packages/zod/src/v4/classic/tests/optional.test.ts',
    'activerecord/test/cases/attribute_methods_test.rb',
    'gohcl/decode_test.go',
    'pgtype/numeric_test.go',
    'tea_test.go',
    'gson/src/test/java/com/google/gson/internal/bind/JsonTreeReaderTest.java',
    'guava-tests/test/com/google/common/hash/HashingTest.java',
    'ktor-http/common/test/io/ktor/tests/http/ContentTypeTest.kt',
    'lib/elixir/test/elixir/calendar/date_test.exs',
    'lib/ex_unit/test/ex_unit/diff_test.exs',
    'spec/lib/http_spec.rb',
    'src/Symfony/Component/EventDispatcher/Tests/Debug/TraceableEventDispatcherTest.php',
    't/unit/tasks/test_canvas.py',
    'test/api_test.rb',
    'test/engine/test_logging.py',
    'test/functional/terminal/tui_spec.lua',
    'test_suite/tests/test_annotations.rs',
    'tests/Carbon/TestingAidsTest.php',
    'tests/CarbonPeriod/GettersTest.php',
    'tests/Humanizer.Tests/NumberToWordsTests.cs',
    'tests/builder/multiple_values.rs',
    'tests/client.rs',
    'tests/repl/test_parser.rs',
    'tests/test_basic.py',
    'Refit.Tests/RequestBuilder.cs',
    'pandas/tests/strings/test_find_replace.py',
    'engine/src/flutter/shell/platform/android/test/io/flutter/plugin/platform/PlatformPluginTest.java',
    'library/test/src/test/java/com/bumptech/glide/request/RequestOptionsTest.java',
    'projects/core/koin-core/src/commonTest/kotlin/org/koin/core/InstanceResolutionTest.kt',
  ])('flags %s as a test file', (path) => {
    expect(isLikelyTestFilePath(path)).toBe(true);
  });

  it.each([
    'src/constant.js',
    'bash_completions.go',
    'lib/parser/tokenizer.py',
    'internal/http/client.go',
    'app/controllers/users_controller.rb',
  ])('does not flag %s as a test file', (path) => {
    expect(isLikelyTestFilePath(path)).toBe(false);
  });
});

describe('stripTestFileHunks', () => {
  const twoFileDiff = [
    'diff --git a/src/constant.js b/src/constant.js',
    'index 111..222 100644',
    '--- a/src/constant.js',
    '+++ b/src/constant.js',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
    'diff --git a/test/display.test.js b/test/display.test.js',
    'index 333..444 100644',
    '--- a/test/display.test.js',
    '+++ b/test/display.test.js',
    '@@ -1,1 +1,1 @@',
    "-expect(x).toBe('old')",
    "+expect(x).toBe('new')",
  ].join('\n');

  it('drops hunks for files that look like test files, keeping the rest', () => {
    const result = stripTestFileHunks(twoFileDiff);

    expect(result.removedFiles).toEqual(['test/display.test.js']);
    expect(result.diff).toContain('src/constant.js');
    expect(result.diff).not.toContain('display.test.js');
    expect(result.diff).not.toContain("expect(x).toBe");
  });

  it('leaves a diff with no test files untouched', () => {
    const implOnly = twoFileDiff.split('diff --git a/test/')[0]!.trim();
    const result = stripTestFileHunks(implOnly);

    expect(result.removedFiles).toEqual([]);
    expect(result.diff.trim()).toBe(implOnly);
  });

  it('returns an empty diff, not a crash, when every file is a test file', () => {
    const onlyTest = twoFileDiff
      .split('\n')
      .slice(7)
      .join('\n');
    const result = stripTestFileHunks(onlyTest);

    expect(result.diff).toBe('');
    expect(result.removedFiles).toEqual(['test/display.test.js']);
  });

  it('handles an empty diff without crashing', () => {
    expect(stripTestFileHunks('')).toEqual({ diff: '', removedFiles: [] });
  });
});
