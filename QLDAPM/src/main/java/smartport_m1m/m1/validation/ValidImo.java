
package smartport_m1m.m1.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target({
    ElementType.FIELD,
    ElementType.PARAMETER,
    ElementType.RECORD_COMPONENT
})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ImoConstraintValidator.class)
public @interface ValidImo {

    String message() default "So IMO khong hop le";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
