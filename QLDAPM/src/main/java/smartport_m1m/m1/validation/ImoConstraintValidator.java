
package smartport_m1m.m1.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class ImoConstraintValidator
        implements ConstraintValidator<ValidImo, String> {

    @Override
    public boolean isValid(
            String imo,
            ConstraintValidatorContext context) {

        // De @NotBlank xu ly gia tri null va rong
        if (imo == null || imo.isBlank()) {
            return true;
        }

        return ImoValidator.isValid(imo);
    }
}
