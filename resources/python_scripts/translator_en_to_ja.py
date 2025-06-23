import dspy
import sys
import os

# --- DSPy Configuration ---
# This script assumes that the DSPy environment is properly configured.
# It uses the model name you provided, which the app can resolve.
# For robust error handling, we'll wrap this in a try-except block.
try:
    lm = dspy.LM("gpt-4.1")
    dspy.configure(lm=lm)
except Exception as e:
    # If the LM fails to load, write the error to stderr and exit.
    # The application will catch this and display an error message.
    print(f"Fatal Error: Could not configure DSPy Language Model. Details: {e}", file=sys.stderr)
    sys.exit(1)

# --- DSPy Program Definition ---
# Define the program signature for translation.
# DSPy will use the LM to understand and execute this transformation.
# Input field: 'english_text'
# Output field: 'japanese_translation'
class EnglishToJapanese(dspy.Signature):
    """Translates English text into Japanese."""
    english_text = dspy.InputField(desc="Text in English")
    japanese_translation = dspy.OutputField(desc="The same text translated into Japanese")

translator = dspy.Predict(EnglishToJapanese)


def main():
    """
    Main function to read from stdin, execute the translation, and print the result.
    """
    # Use sys.stdin.read() to get the clipboard content passed by the app.
    input_text = sys.stdin.read()

    if not input_text.strip():
        # Handle cases where the clipboard is empty or just whitespace.
        print("Input is empty, no translation performed.", file=sys.stderr)
        return

    try:
        # Execute the translation program.
        result = translator(english_text=input_text)
        
        # Use print() to output the result to stdout.
        # The application will capture this and copy it to the clipboard.
        print(result.japanese_translation)
        
    except Exception as e:
        print(f"An error occurred during translation: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main() 