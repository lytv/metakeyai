#!/usr/bin/env python3
"""
Text Analyzer Script for MetaKeyAI
Analyzes clipboard text and provides insights.
"""

import sys
import json
import re
from collections import Counter
from typing import Dict, Any

def analyze_text(text: str) -> Dict[str, Any]:
    """Analyze text and return comprehensive statistics."""
    
    # Basic statistics
    char_count = len(text)
    char_count_no_spaces = len(text.replace(' ', ''))
    word_count = len(text.split())
    sentence_count = len(re.findall(r'[.!?]+', text))
    paragraph_count = len([p for p in text.split('\n\n') if p.strip()])
    
    # Line statistics
    lines = text.split('\n')
    line_count = len(lines)
    avg_line_length = sum(len(line) for line in lines) / line_count if line_count > 0 else 0
    
    # Word analysis
    words = re.findall(r'\b\w+\b', text.lower())
    avg_word_length = sum(len(word) for word in words) / len(words) if words else 0
    
    # Most common words (excluding common stop words)
    stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'}
    
    meaningful_words = [word for word in words if word not in stop_words and len(word) > 2]
    word_freq = Counter(meaningful_words)
    most_common = word_freq.most_common(10)
    
    # Reading time estimation (average 200 words per minute)
    reading_time_minutes = word_count / 200
    
    # Text complexity (simple heuristic)
    avg_sentence_length = word_count / sentence_count if sentence_count > 0 else 0
    complexity_score = min(10, max(1, (avg_word_length * 2 + avg_sentence_length / 5)))
    
    # Detect potential content type
    content_type = detect_content_type(text)
    
    # Language detection (simple heuristic)
    language = detect_language(text)
    
    return {
        'basic_stats': {
            'characters': char_count,
            'characters_no_spaces': char_count_no_spaces,
            'words': word_count,
            'sentences': sentence_count,
            'paragraphs': paragraph_count,
            'lines': line_count
        },
        'averages': {
            'word_length': round(avg_word_length, 2),
            'sentence_length': round(avg_sentence_length, 2),
            'line_length': round(avg_line_length, 2)
        },
        'reading_stats': {
            'reading_time_minutes': round(reading_time_minutes, 1),
            'complexity_score': round(complexity_score, 1),
            'complexity_level': get_complexity_level(complexity_score)
        },
        'word_analysis': {
            'unique_words': len(set(words)),
            'vocabulary_richness': round(len(set(words)) / len(words), 3) if words else 0,
            'most_common_words': most_common[:5]
        },
        'content_info': {
            'type': content_type,
            'language': language
        }
    }

def detect_content_type(text: str) -> str:
    """Detect the type of content based on patterns."""
    
    # Check for code patterns
    code_indicators = ['def ', 'function ', 'class ', 'import ', '#include', 'console.log', 'print(', '<?php', '<html', 'SELECT ', 'FROM ']
    if any(indicator in text for indicator in code_indicators):
        return 'code'
    
    # Check for email patterns
    if '@' in text and re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', text):
        return 'email'
    
    # Check for URL patterns
    if re.search(r'https?://|www\.', text):
        return 'web_content'
    
    # Check for markdown patterns
    markdown_indicators = ['# ', '## ', '- [', '```', '**', '__']
    if any(indicator in text for indicator in markdown_indicators):
        return 'markdown'
    
    # Check for structured data
    if text.strip().startswith('{') or text.strip().startswith('['):
        return 'json'
    
    # Check for CSV-like data
    if ',' in text and '\n' in text:
        lines = text.strip().split('\n')
        if len(lines) > 1 and all(',' in line for line in lines[:3]):
            return 'csv'
    
    # Check for list patterns
    list_indicators = [re.match(r'^\d+\.', line.strip()) for line in text.split('\n')]
    if any(list_indicators):
        return 'numbered_list'
    
    bullet_indicators = [line.strip().startswith(('- ', '* ', '• ')) for line in text.split('\n')]
    if any(bullet_indicators):
        return 'bullet_list'
    
    return 'plain_text'

def detect_language(text: str) -> str:
    """Simple language detection based on common words."""
    
    # English indicators
    english_words = ['the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but', 'his', 'from', 'they']
    english_score = sum(1 for word in english_words if word in text.lower())
    
    # Spanish indicators
    spanish_words = ['que', 'de', 'no', 'en', 'un', 'ser', 'se', 'te', 'todo', 'le', 'da', 'su', 'por']
    spanish_score = sum(1 for word in spanish_words if word in text.lower())
    
    # French indicators
    french_words = ['le', 'de', 'et', 'que', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce']
    french_score = sum(1 for word in french_words if word in text.lower())
    
    scores = {'english': english_score, 'spanish': spanish_score, 'french': french_score}
    max_lang = max(scores, key=scores.get)
    
    return max_lang if scores[max_lang] > 2 else 'unknown'

def get_complexity_level(score: float) -> str:
    """Convert complexity score to human-readable level."""
    if score <= 3:
        return 'Simple'
    elif score <= 5:
        return 'Easy'
    elif score <= 7:
        return 'Moderate'
    elif score <= 8:
        return 'Complex'
    else:
        return 'Very Complex'

def main():
    """Main function to process stdin and output analysis."""
    try:
        # Read text from stdin
        text = sys.stdin.read().strip()
        
        if not text:
            print(json.dumps({'error': 'No text provided'}))
            return
        
        # Analyze the text
        analysis = analyze_text(text)
        
        # Output as JSON
        print(json.dumps(analysis, indent=2))
        
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
