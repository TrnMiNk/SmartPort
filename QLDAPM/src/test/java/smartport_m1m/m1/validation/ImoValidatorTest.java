
package smartport_m1m.m1.validation;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ImoValidatorTest {

    @Test
    void validImoShouldPass() {
        assertTrue(ImoValidator.isValid("9074729"));
    }

    @Test
    void wrongChecksumShouldFail() {
        assertFalse(ImoValidator.isValid("9074728"));
    }

    @Test
    void sixDigitsShouldFail() {
        assertFalse(ImoValidator.isValid("907472"));
    }

    @Test
    void lettersShouldFail() {
        assertFalse(ImoValidator.isValid("90747A9"));
    }

    @Test
    void zeroImoShouldFail() {
        assertFalse(ImoValidator.isValid("0000000"));
    }

    @Test
    void nullShouldFail() {
        assertFalse(ImoValidator.isValid(null));
    }
}
