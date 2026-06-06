<?php

declare(strict_types=1);

namespace Tests\Libraries;

use App\Libraries\MemorablePhrase;
use CodeIgniter\Test\CIUnitTestCase;
use RuntimeException;

/**
 * Tests for the MemorablePhrase library used to mint gift-card transfer
 * tokens. We do NOT test the wordlist content (curation choice) — we test
 * the structural guarantees the rest of the codebase depends on:
 *
 *  - The phrase always has exactly $wordCount hyphen-separated lowercase
 *    words pulled from the embedded list.
 *  - Default 6 words gives ~48 bits of entropy (we sanity-check via
 *    collision resistance on a small sample, not a statistical test).
 *  - `looksValid()` accepts what `generate()` produces and rejects
 *    obviously malformed input.
 *  - Edge cases on word count throw rather than producing silently bad
 *    tokens that would later fail the hash lookup.
 */
final class MemorablePhraseTest extends CIUnitTestCase
{
    public function testDefaultPhraseHasSixHyphenSeparatedWords(): void
    {
        $phrase = MemorablePhrase::generate();
        $parts = explode('-', $phrase);
        $this->assertCount(6, $parts, "Default phrase should have exactly 6 words, got: $phrase");
    }

    public function testPhraseWordsAreLowercaseAlpha(): void
    {
        $phrase = MemorablePhrase::generate();
        foreach (explode('-', $phrase) as $word) {
            $this->assertMatchesRegularExpression('/^[a-z]+$/', $word, "Word '$word' should be lowercase alpha only");
            $this->assertGreaterThanOrEqual(3, strlen($word), "Word '$word' should be ≥3 chars");
            $this->assertLessThanOrEqual(7, strlen($word), "Word '$word' should be ≤7 chars");
        }
    }

    public function testCustomWordCountIsRespected(): void
    {
        foreach ([4, 5, 6, 7, 8, 10, 12] as $n) {
            $phrase = MemorablePhrase::generate($n);
            $this->assertCount($n, explode('-', $phrase), "Requested $n words");
        }
    }

    public function testWordCountBelowFourThrows(): void
    {
        $this->expectException(RuntimeException::class);
        MemorablePhrase::generate(3);
    }

    public function testWordCountAboveTwelveThrows(): void
    {
        $this->expectException(RuntimeException::class);
        MemorablePhrase::generate(13);
    }

    public function testLooksValidAcceptsRealGeneratedPhrases(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $phrase = MemorablePhrase::generate();
            $this->assertTrue(
                MemorablePhrase::looksValid($phrase),
                "Generated phrase should pass looksValid(): $phrase",
            );
        }
    }

    public function testLooksValidAcceptsLongerPhrases(): void
    {
        $this->assertTrue(MemorablePhrase::looksValid(MemorablePhrase::generate(4)));
        $this->assertTrue(MemorablePhrase::looksValid(MemorablePhrase::generate(8)));
        $this->assertTrue(MemorablePhrase::looksValid(MemorablePhrase::generate(12)));
    }

    public function testLooksValidRejectsMalformedInput(): void
    {
        $bad = [
            '',                              // empty
            'one',                           // single word, no hyphens
            'one-two',                       // too few words
            'one-two-three',                 // too few words (regex requires ≥4)
            'CORAL-music-river-jet-vivid-mango', // uppercase
            'coral_music_river_jet_vivid_mango', // wrong separator
            'coral music river jet vivid mango', // spaces
            'a1b2-c3d4-e5f6-g7h8',           // digits
            '0123456789abcdef0123456789abcdef', // 32-hex legacy token
            'coral--music-river-jet-vivid-mango', // double hyphen
            '-coral-music-river-jet-vivid-mango', // leading hyphen
            'coral-music-river-jet-vivid-mango-', // trailing hyphen
        ];
        foreach ($bad as $candidate) {
            $this->assertFalse(
                MemorablePhrase::looksValid($candidate),
                "Should reject malformed input: '$candidate'",
            );
        }
    }

    /**
     * Sanity check for entropy: in 1,000 6-word phrases pulled from a
     * 256-word list, we expect zero exact duplicates with overwhelming
     * probability (collision probability ≈ N²/2W^6 ≈ 1.7 × 10^-9 here).
     * If this fails the random_int call is broken or the wordlist has
     * shrunk dramatically — both are blockers.
     */
    public function testNoCollisionsAcrossOneThousandGenerations(): void
    {
        $seen = [];
        for ($i = 0; $i < 1000; $i++) {
            $phrase = MemorablePhrase::generate();
            $this->assertArrayNotHasKey($phrase, $seen, "Unexpected collision on iteration $i: $phrase");
            $seen[$phrase] = true;
        }
    }

    /**
     * Sanity check that the wordlist actually has 256 distinct slots. If
     * a future contributor accidentally drops a word and breaks the index
     * arithmetic in generate(), this catches it loudly.
     *
     * Coupon-collector for 256 buckets needs ~256·H_256 ≈ 1,560 picks for
     * full coverage; 10,000 picks (2,500 × 4-word phrases) is plenty.
     */
    public function testEachWordIndexIsReachable(): void
    {
        $unique = [];
        for ($i = 0; $i < 2500; $i++) {
            foreach (explode('-', MemorablePhrase::generate(4)) as $w) {
                $unique[$w] = true;
            }
        }
        $this->assertGreaterThanOrEqual(
            240,
            count($unique),
            'Wordlist coverage is suspiciously low; expected ~256 distinct words across 10,000 picks',
        );
    }
}
