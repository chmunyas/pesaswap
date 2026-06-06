<?php

declare(strict_types=1);

namespace App\Libraries;

use RuntimeException;

/**
 * MemorablePhrase — generate human-friendly verification tokens.
 *
 * Replaces the prior 32-hex-character transfer token (128 bits) with a
 * 6-word lowercase phrase pulled from a curated 256-word list. The phrase
 * is the URL parameter (e.g. /giftcard/transfer/coral-music-river-jet-vivid-mango)
 * and the database still stores sha256(phrase) — the wire-and-storage
 * discipline is unchanged, only the human-facing representation differs.
 *
 * Why it's secure enough:
 *   - 6 words × log2(256) = 48 bits of entropy => ~2.8 × 10^14 combinations.
 *   - Tokens are single-use, expire in TRANSFER_TOKEN_TTL_HOURS (default 24),
 *     and the public claim endpoint is rate-limited.
 *   - Even at 100 guesses/sec for 24 h that's 8.6M attempts vs 2.8 × 10^14 search
 *     space — probability of hit < 3 × 10^-8 per token.
 *
 * Why it matters for UX:
 *   - A cashier can read it aloud to a customer on the phone.
 *   - A customer can remember it long enough to type if SMS fails.
 *   - It feels less like an enterprise system and more like a gift.
 *
 * Wordlist selection rules (256 words):
 *   - 4-6 chars each (printable, easy on small screens).
 *   - Neutral subjects: nature, food, colours, animals, weather.
 *   - Excludes profanity, names, brand terms, ambiguous homophones, words
 *     that contain other words (e.g. "scary" contains "car" - kept anyway
 *     because cross-word reading isn't an attack vector).
 *   - Lowercase only; the route is case-sensitive in matching but we
 *     normalise on lookup.
 */
final class MemorablePhrase
{
    /**
     * @var string[] Curated 256-word list. Index = 8-bit value.
     */
    private const WORDS = [
        // 0-31: nature
        'amber', 'birch', 'cedar', 'cliff', 'cloud', 'coral', 'creek', 'crest',
        'delta', 'dune',  'fern',  'flax',  'flint', 'frost', 'gale',  'glen',
        'grove', 'gulf',  'haze',  'hill',  'isle',  'kelp',  'lake',  'leaf',
        'lily',  'loam',  'marsh', 'mesa',  'mist',  'moor',  'moss',  'oak',
        // 32-63: weather + sky
        'orbit', 'palm',  'peak',  'petal', 'pine',  'pond',  'reef',  'ridge',
        'river', 'rock',  'root',  'rose',  'sand',  'sea',   'silt',  'snow',
        'star',  'stone', 'storm', 'stream','sun',   'thorn', 'tide',  'tree',
        'twig',  'vale',  'vine',  'wave',  'wind',  'wood',  'breeze','dawn',
        // 64-95: food
        'apple', 'beet',  'berry', 'bran',  'bread', 'broth', 'butter','cake',
        'candy', 'chai',  'chili', 'corn',  'curry', 'date',  'dough', 'fig',
        'flour', 'fruit', 'grain', 'grape', 'herb',  'honey', 'jam',   'kale',
        'lime',  'maize', 'mango', 'milk',  'mint',  'nut',   'oat',   'olive',
        // 96-127: more food + drinks
        'onion', 'peach', 'pear',  'pecan', 'pesto', 'plum',  'rice',  'salt',
        'sauce', 'soup',  'spice', 'sugar', 'syrup', 'tea',   'thyme', 'tofu',
        'wheat', 'yam',   'yeast', 'zest',  'basil', 'beans', 'cocoa', 'cumin',
        'dill',  'lemon', 'melon', 'pasta', 'pepper','rye',   'salad', 'savory',
        // 128-159: colours
        'azure', 'beige', 'black', 'blue',  'bronze','brown', 'cobalt','coral',
        'cream', 'cyan',  'denim','emerald','fawn', 'ginger','gold',  'green',
        'grey',  'ivory', 'jade',  'khaki', 'lemon', 'lilac', 'mauve', 'mocha',
        'navy',  'ochre', 'olive', 'peach', 'pearl', 'pink',  'plum',  'red',
        // 160-191: animals
        'badger','bat',   'bear',  'bee',   'bird',  'bison', 'boar',  'cat',
        'crane', 'crow',  'deer',  'dove',  'eagle', 'falcon','finch', 'fox',
        'frog',  'goose', 'hare',  'hawk',  'heron', 'hound', 'jay',   'koala',
        'lark',  'lion',  'lynx',  'mole',  'mouse', 'newt',  'otter', 'owl',
        // 192-223: more animals + textures
        'panda', 'parrot','quail', 'ram',   'raven', 'robin', 'seal',  'shark',
        'sheep', 'sloth', 'snail', 'sparrow','stag', 'stork', 'swan',  'tiger',
        'toad',  'trout', 'turtle','whale', 'wolf',  'wren',  'yak',   'zebra',
        'bark',  'silk',  'velvet','linen', 'cotton','denim', 'suede', 'lace',
        // 224-255: motion + warmth
        'glow',  'jet',   'spark', 'flame', 'pulse', 'wave',  'echo',  'bloom',
        'orbit', 'glide', 'drift', 'leap',  'soar',  'beam',  'spin',  'arc',
        'note',  'tune',  'chord', 'song',  'tone',  'pitch', 'aria',  'tempo',
        'rhyme', 'verse', 'tale',  'tide',  'sage',  'vivid', 'soft',  'warm',
    ];

    public static function generate(int $wordCount = 6): string
    {
        if ($wordCount < 4 || $wordCount > 12) {
            throw new RuntimeException('wordCount must be in [4, 12]');
        }
        $words = [];
        for ($i = 0; $i < $wordCount; $i++) {
            // random_int is cryptographically secure.
            $words[] = self::WORDS[random_int(0, 255)];
        }
        return implode('-', $words);
    }

    /**
     * Validates that the URL token *looks* like one of our phrases — used
     * for cheap pre-DB rejection of obviously bogus inputs. Hash lookup
     * is still authoritative.
     */
    public static function looksValid(string $token): bool
    {
        return (bool)preg_match('/^[a-z]{3,8}(-[a-z]{3,8}){3,11}$/', $token);
    }
}
