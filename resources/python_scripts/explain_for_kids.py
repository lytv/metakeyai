import dspy
import sys
import os

# --- DSPy Configuration ---
try:
    lm = dspy.LM("gpt-4.1")
    dspy.configure(lm=lm)
except Exception as e:
    print(f"Fatal Error: Could not configure DSPy Language Model. Details: {e}", file=sys.stderr)
    sys.exit(1)

# --- DSPy Program Definition ---
# Define the program signature for explanation for kids.
# Input field: 'english_text'
# Output field: 'kids_explanation'
class ExplainForKids(dspy.Signature):
    """Explains English text in a way that children can understand."""
    english_text = dspy.InputField(desc="Text in English")
    kids_explanation = dspy.OutputField(desc="A simple explanation for kids")

explainer = dspy.Predict(ExplainForKids)

def main():
    """
    Main function to read from stdin, explain the text for kids, and print the result.
    """
    input_text = sys.stdin.read()

    if not input_text.strip():
        print("Input is empty, no explanation performed.", file=sys.stderr)
        return

    try:
        result = explainer(english_text=input_text)
        print(result.kids_explanation)
    except Exception as e:
        print(f"An error occurred during explanation: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main() 